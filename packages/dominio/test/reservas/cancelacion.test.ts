import assert from "node:assert/strict";
import { test } from "node:test";
import { calcularCancelacion, describirPolitica, diasEntre, generarCodigoReserva } from "../../src/reservas/index.ts";

const flexible = [
  { diasAntesLlegada: 3, penalizacionBp: 0 },
  { diasAntesLlegada: 0, penalizacionBp: 2500 },
];

test("gratis con anticipación suficiente: se devuelve todo el anticipo", () => {
  assert.deepEqual(calcularCancelacion({ reglas: flexible, diasAntesLlegada: 5, totalCentavos: 26_000n, pagadoCentavos: 6_500n }), {
    penalizacionCentavos: 0n, reembolsoCentavos: 6_500n, penalizacionBp: 0,
  });
});

test("tarde: se retiene el 25 % del total, que es el anticipo", () => {
  assert.deepEqual(calcularCancelacion({ reglas: flexible, diasAntesLlegada: 1, totalCentavos: 26_000n, pagadoCentavos: 6_500n }), {
    penalizacionCentavos: 6_500n, reembolsoCentavos: 0n, penalizacionBp: 2500,
  });
});

test("nunca retiene más de lo pagado", () => {
  const estricta = [{ diasAntesLlegada: 0, penalizacionBp: 10_000 }];
  assert.equal(calcularCancelacion({ reglas: estricta, diasAntesLlegada: 10, totalCentavos: 26_000n, pagadoCentavos: 6_500n }).penalizacionCentavos, 6_500n);
});

test("el día de llegada o después aplica la regla de 0 días", () => {
  assert.equal(calcularCancelacion({ reglas: flexible, diasAntesLlegada: -2, totalCentavos: 10_000n, pagadoCentavos: 10_000n }).penalizacionBp, 2500);
});

test("diasEntre y frase de la política", () => {
  assert.equal(diasEntre("2026-12-01", "2026-12-04"), 3);
  assert.equal(describirPolitica(flexible, "2026-12-12", "es"), "Cancelación gratis hasta el 9 dic");
  assert.equal(describirPolitica(flexible, "2026-12-12", "en"), "Free cancellation until Dec 9");
  assert.match(describirPolitica([{ diasAntesLlegada: 0, penalizacionBp: 10_000 }], "2026-12-12", "es"), /No reembolsable/);
});

test("códigos legibles WP-XXXXXX sin caracteres confusos", () => {
  for (let i = 0; i < 200; i++) assert.match(generarCodigoReserva(), /^WP-[A-HJ-NP-Z2-9]{6}$/);
});
