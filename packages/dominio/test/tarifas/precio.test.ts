import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DatoInvalido,
  SinMargenVigente,
  calcularEstadia,
  calcularNoche,
  seleccionarReglaMargen,
  type ReglaMargenVigente,
} from "../../src/tarifas/index.ts";

const COP_1000 = 100_000n; // redondeo a 1.000 COP, en centavos
const USD_1 = 100n; // redondeo a 1 USD

const margenHotel30: ReglaMargenVigente = {
  id: "hotel-30",
  planTarifaId: null,
  vigenteDesde: "2026-01-01",
  vigenteHasta: null,
  regla: { tipo: "porcentaje", porcentajeBp: 3000 },
};

describe("calcularNoche", () => {
  test("neta 50.000 + 30 % = 65.000 al público (ejemplo del negocio)", () => {
    const noche = calcularNoche(5_000_000n, { tipo: "porcentaje", porcentajeBp: 3000 }, COP_1000);
    assert.deepEqual(noche, { netoCentavos: 5_000_000n, margenCentavos: 1_500_000n, ventaCentavos: 6_500_000n });
  });

  test("monto fijo: neta 50.000 + 15.000", () => {
    const noche = calcularNoche(5_000_000n, { tipo: "monto_fijo", montoCentavos: 1_500_000n }, COP_1000);
    assert.equal(noche.ventaCentavos, 6_500_000n);
  });

  test("redondea la venta hacia arriba y suma el redondeo al margen", () => {
    // 87,40 + 30 % (26,22) = 113,62 → 114,00 USD
    const noche = calcularNoche(8_740n, { tipo: "porcentaje", porcentajeBp: 3000 }, USD_1);
    assert.equal(noche.ventaCentavos, 11_400n);
    assert.equal(noche.margenCentavos, 2_660n);
  });

  test("redondea el margen porcentual hacia arriba al centavo", () => {
    // 10,01 × 15 % = 1,5015 → 1,51
    const noche = calcularNoche(1_001n, { tipo: "porcentaje", porcentajeBp: 1500 }, 1n);
    assert.equal(noche.margenCentavos, 151n);
  });

  test("rechaza datos inválidos", () => {
    assert.throws(() => calcularNoche(0n, { tipo: "porcentaje", porcentajeBp: 3000 }, USD_1), DatoInvalido);
    assert.throws(() => calcularNoche(100n, { tipo: "porcentaje", porcentajeBp: 30.5 }, USD_1), DatoInvalido);
    assert.throws(() => calcularNoche(100n, { tipo: "porcentaje", porcentajeBp: 10_001 }, USD_1), DatoInvalido);
    assert.throws(() => calcularNoche(100n, { tipo: "monto_fijo", montoCentavos: -1n }, USD_1), DatoInvalido);
    assert.throws(() => calcularNoche(100n, { tipo: "monto_fijo", montoCentavos: 1n }, 0n), DatoInvalido);
  });
});

describe("seleccionarReglaMargen", () => {
  const temporadaAltaPlan: ReglaMargenVigente = {
    id: "plan-alta",
    planTarifaId: "plan-desayuno",
    vigenteDesde: "2026-12-15",
    vigenteHasta: "2027-01-15",
    regla: { tipo: "porcentaje", porcentajeBp: 3500 },
  };
  const reglas = [margenHotel30, temporadaAltaPlan];

  test("la regla del plan gana dentro de su vigencia", () => {
    assert.equal(seleccionarReglaMargen(reglas, "2026-12-20", "plan-desayuno").id, "plan-alta");
  });

  test("fuera de la vigencia del plan aplica la del hotel", () => {
    assert.equal(seleccionarReglaMargen(reglas, "2027-01-16", "plan-desayuno").id, "hotel-30");
  });

  test("otro plan usa la regla del hotel", () => {
    assert.equal(seleccionarReglaMargen(reglas, "2026-12-20", "plan-solo-habitacion").id, "hotel-30");
  });

  test("vigenteHasta es inclusivo", () => {
    assert.equal(seleccionarReglaMargen(reglas, "2027-01-15", "plan-desayuno").id, "plan-alta");
  });

  test("sin regla vigente no se puede vender: no hay margen global", () => {
    assert.throws(() => seleccionarReglaMargen(reglas, "2025-12-31", "plan-desayuno"), SinMargenVigente);
    assert.throws(() => seleccionarReglaMargen([], "2026-06-01", "plan-desayuno"), SinMargenVigente);
  });
});

describe("calcularEstadia", () => {
  test("reparto del ejemplo del negocio: anticipo 16.250, saldo 48.750, liquidación 1.250", () => {
    const estadia = calcularEstadia({
      noches: [{ fecha: "2026-11-10", netoCentavos: 5_000_000n }],
      planTarifaId: "plan-base",
      reglasMargen: [margenHotel30],
      anticipoBp: 2500,
      redondeoCentavos: COP_1000,
    });
    assert.equal(estadia.totalVentaCentavos, 6_500_000n);
    assert.equal(estadia.totalMargenCentavos, 1_500_000n);
    assert.equal(estadia.anticipoCentavos, 1_625_000n);
    assert.equal(estadia.saldoCentavos, 4_875_000n);
    assert.equal(estadia.liquidacionHotelCentavos, 125_000n);
    assert.equal(estadia.totalNetoCentavos + estadia.totalMargenCentavos, estadia.totalVentaCentavos);
  });

  test("el anticipo nunca es menor que el margen", () => {
    const margenAlto: ReglaMargenVigente = { ...margenHotel30, id: "fijo-alto", regla: { tipo: "monto_fijo", montoCentavos: 6_000n } };
    const estadia = calcularEstadia({
      noches: [{ fecha: "2026-11-10", netoCentavos: 10_000n }],
      planTarifaId: "plan-base",
      reglasMargen: [margenAlto],
      anticipoBp: 2500,
      redondeoCentavos: USD_1,
    });
    // venta 160 USD; 25 % = 40 USD < margen 60 USD → anticipo 60 USD, liquidación 0
    assert.equal(estadia.anticipoCentavos, 6_000n);
    assert.equal(estadia.liquidacionHotelCentavos, 0n);
    assert.equal(estadia.saldoCentavos, 10_000n);
  });

  test("anticipo del 100 % cobra todo y no deja saldo", () => {
    const estadia = calcularEstadia({
      noches: [{ fecha: "2026-11-10", netoCentavos: 10_000n }],
      planTarifaId: "plan-base",
      reglasMargen: [margenHotel30],
      anticipoBp: 10_000,
      redondeoCentavos: USD_1,
    });
    assert.equal(estadia.anticipoCentavos, estadia.totalVentaCentavos);
    assert.equal(estadia.saldoCentavos, 0n);
  });

  test("cada noche usa la regla vigente de su fecha", () => {
    const temporadaAlta: ReglaMargenVigente = {
      id: "hotel-alta",
      planTarifaId: "plan-base",
      vigenteDesde: "2026-12-31",
      vigenteHasta: "2026-12-31",
      regla: { tipo: "porcentaje", porcentajeBp: 5000 },
    };
    const estadia = calcularEstadia({
      noches: [
        { fecha: "2026-12-30", netoCentavos: 10_000n },
        { fecha: "2026-12-31", netoCentavos: 10_000n },
      ],
      planTarifaId: "plan-base",
      reglasMargen: [margenHotel30, temporadaAlta],
      anticipoBp: 2500,
      redondeoCentavos: USD_1,
    });
    assert.deepEqual(estadia.noches.map((noche) => noche.ventaCentavos), [13_000n, 15_000n]);
    assert.deepEqual(estadia.noches.map((noche) => noche.reglaMargenId), ["hotel-30", "hotel-alta"]);
  });

  test("falla si alguna noche no tiene margen vigente", () => {
    assert.throws(
      () =>
        calcularEstadia({
          noches: [{ fecha: "2025-06-01", netoCentavos: 10_000n }],
          planTarifaId: "plan-base",
          reglasMargen: [margenHotel30],
          anticipoBp: 2500,
          redondeoCentavos: USD_1,
        }),
      SinMargenVigente,
    );
  });

  test("rechaza una estadía vacía", () => {
    assert.throws(
      () => calcularEstadia({ noches: [], planTarifaId: "p", reglasMargen: [margenHotel30], anticipoBp: 2500, redondeoCentavos: USD_1 }),
      DatoInvalido,
    );
  });
});
