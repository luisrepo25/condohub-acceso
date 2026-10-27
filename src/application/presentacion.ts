import type { Alerta } from '@/domain/model/alerta';
import type { Pase } from '@/domain/model/pase';
import type { RegistroAcceso } from '@/domain/model/registro-acceso';
import type { Visita } from '@/domain/model/visita';

/**
 * Formas del contrato (contracts/openapi/acceso.yaml). Viven en la aplicación porque la respuesta se guarda tal cual
 * para devolverla igual ante una Idempotency-Key repetida (O3). Fechas en ISO-8601 UTC.
 */

export function paseJson(pase: Pase, ahora: Date) {
  const d = pase.datos;
  return {
    codigo: d.codigo,
    ...(d.visitaId ? { visitaId: d.visitaId } : {}),
    unidadCodigo: d.unidadCodigo,
    estado: pase.estadoEn(ahora),
    usos: d.usos,
    usosMaximos: d.usosMaximos,
    validoDesde: d.validoDesde.toISOString(),
    validoHasta: d.validoHasta.toISOString(),
    origen: d.origen,
  };
}

export function visitaJson(visita: Visita, ahora: Date) {
  const d = visita.datos;
  return {
    visitaId: d.visitaId,
    unidadCodigo: d.unidadCodigo,
    nombre: d.nombre,
    ...(d.documento ? { documento: d.documento } : {}),
    fecha: d.fecha,
    pase: paseJson(visita.pase, ahora),
  };
}

export function registroJson(registro: RegistroAcceso) {
  const d = registro.datos;
  const opcionales = {
    unidadCodigo: d.unidadCodigo,
    paseCodigo: d.paseCodigo,
    placa: d.placa,
    confianzaPlaca: d.confianzaPlaca,
    motivo: d.motivo,
    corrigeA: d.corrigeA,
  };
  return {
    registroId: d.registroId,
    sentido: d.sentido,
    categoria: d.categoria,
    ...Object.fromEntries(Object.entries(opcionales).filter(([, v]) => v !== undefined)),
    resultado: d.resultado,
    horaDispositivo: d.horaDispositivo.toISOString(),
    horaServidor: d.horaServidor.toISOString(),
    guardiaSub: d.guardiaSub,
    ...(d.observacion ? { observacion: d.observacion } : {}),
  };
}

export function alertaJson(alerta: Alerta) {
  return {
    id: alerta.id,
    tipo: alerta.tipo,
    clusterId: alerta.clusterId,
    apariciones: alerta.apariciones,
    diasDistintos: alerta.diasDistintos,
    creadaEn: alerta.creadaEn.toISOString(),
  };
}
