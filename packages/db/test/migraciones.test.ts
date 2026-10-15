import assert from "node:assert/strict";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CARPETA_MIGRACIONES, MigracionModificada, leerMigraciones, migrar } from "../src/index.ts";
import { crearBaseVacia } from "./ayudantes.ts";

test("las migraciones tienen nombres válidos, versiones consecutivas y no están vacías", async () => {
  const migraciones = await leerMigraciones();
  assert.ok(migraciones.length >= 7);
  migraciones.forEach((migracion, indice) => {
    assert.equal(migracion.version, String(indice + 1).padStart(4, "0"));
    assert.ok(migracion.sql.trim().length > 0);
  });
});

test("se aplican sobre una base vacía y una segunda ejecución no hace nada", async () => {
  const db = await crearBaseVacia();
  const primera = await migrar(db);
  assert.equal(primera.aplicadas.length, (await leerMigraciones()).length);

  const segunda = await migrar(db);
  assert.deepEqual(segunda.aplicadas, []);
  assert.equal(segunda.yaAplicadas, primera.aplicadas.length);
  await db.close();
});

test("crea los esquemas por módulo y los datos de referencia del lanzamiento", async () => {
  const db = await crearBaseVacia();
  await migrar(db);

  const esquemas = await db.query<{ nombre: string }>(
    "SELECT schema_name AS nombre FROM information_schema.schemata WHERE schema_name IN ('geo','identidad','catalogo','tarifas','reservas') ORDER BY 1",
  );
  assert.deepEqual(esquemas.rows.map((fila) => fila.nombre), ["catalogo", "geo", "identidad", "reservas", "tarifas"]);

  const paises = await db.query<{ codigo: string; moneda_codigo: string }>("SELECT codigo, moneda_codigo FROM geo.paises ORDER BY codigo");
  assert.deepEqual(paises.rows, [
    { codigo: "CO", moneda_codigo: "COP" },
    { codigo: "PA", moneda_codigo: "USD" },
  ]);

  const ciudades = await db.query<{ slug: string }>(
    "SELECT slug FROM geo.ciudad_traducciones WHERE idioma_codigo = 'es' ORDER BY slug",
  );
  assert.deepEqual(ciudades.rows.map((fila) => fila.slug), ["bocas-del-toro", "boquete", "cartagena", "ciudad-de-panama"]);

  const servicios = await db.query<{ total: number }>(
    "SELECT count(*)::int AS total FROM catalogo.servicio_traducciones",
  );
  assert.equal(servicios.rows[0].total, 32); // 16 servicios × es/en
  await db.close();
});

test("rechaza una migración ya aplicada cuyo archivo cambió", async () => {
  const carpeta = await mkdtemp(path.join(os.tmpdir(), "wopa-migraciones-"));
  try {
    await cp(CARPETA_MIGRACIONES, carpeta, { recursive: true });
    const db = await crearBaseVacia();
    await migrar(db, { carpeta });

    await writeFile(path.join(carpeta, "0002_geo.sql"), "-- editada\nSELECT 1;");
    await assert.rejects(migrar(db, { carpeta }), MigracionModificada);
    await db.close();
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});

test("una migración que falla no deja cambios a medias", async () => {
  const carpeta = await mkdtemp(path.join(os.tmpdir(), "wopa-migraciones-"));
  try {
    await writeFile(path.join(carpeta, "0001_ok.sql"), "CREATE TABLE public.uno (id int);");
    await writeFile(path.join(carpeta, "0002_rota.sql"), "CREATE TABLE public.dos (id int);\nSELECT * FROM tabla_que_no_existe;");
    const db = await crearBaseVacia();

    await assert.rejects(migrar(db, { carpeta }), /0002_rota/);
    const tablas = await db.query<{ nombre: string }>(
      "SELECT tablename AS nombre FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('uno','dos') ORDER BY 1",
    );
    assert.deepEqual(tablas.rows.map((fila) => fila.nombre), ["uno"]);
    const registro = await db.query<{ version: string }>("SELECT version FROM public.migraciones_aplicadas");
    assert.deepEqual(registro.rows.map((fila) => fila.version), ["0001"]);
    await db.close();
  } finally {
    await rm(carpeta, { recursive: true, force: true });
  }
});
