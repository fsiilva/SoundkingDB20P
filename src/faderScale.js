// D-Touch 20 InitConvTab at 0x1000ffe3c, constants 0x100159040..070.
// This is the app's post-fader meter gain approximation, not an acoustic calibration.
export function appFaderDb(raw){if(!Number.isFinite(raw)||raw<0||raw>1000)return null;const x=Math.trunc(raw);return Math.fround(-1.789e-15*x**6+6.199e-12*x**5-8.398e-9*x**4+5.669e-6*x**3-.002059*x*x+.4686*x-80.51)}
export function displayAppDb(raw){const db=appFaderDb(raw);return db===null?'Escala indisponível':`≈ ${db.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1})} dB`}
