import { randomUUID } from 'node:crypto';
import { ListarPlacas } from '@/application/listar-placas';
import { PasesParaGuardia } from '@/application/pases-para-guardia';
import { RegistrarAcceso } from '@/application/registrar-acceso';
import { RegistrarVisita } from '@/application/registrar-visita';
import { SincronizarLote } from '@/application/sincronizar-lote';
import { ValidarPase } from '@/application/validar-pase';
import { configPasesDesdeEntorno, nuevoCodigoPase } from './config-pases';
import { configDynamoDesdeEntorno, crearClienteDynamo } from './dynamodb/cliente';
import { PlacasDynamo } from './dynamodb/placas-dynamo';
import { RegistroAccesoDynamo } from './dynamodb/registro-acceso-dynamo';
import { VisitaPaseDynamo } from './dynamodb/visita-pase-dynamo';
import { UnidadesGestion } from './gestion/unidades-gestion';

export interface CasosDeUso {
  readonly registrarAcceso: RegistrarAcceso;
  readonly sincronizarLote: SincronizarLote;
  readonly registrarVisita: RegistrarVisita;
  readonly validarPase: ValidarPase;
  readonly pasesParaGuardia: PasesParaGuardia;
  readonly listarPlacas: ListarPlacas;
}

let casos: CasosDeUso | undefined;

/** Los tests inyectan casos de uso con repositorios propios. */
export function usarCasosDeUso(c: CasosDeUso | undefined): void {
  casos = c;
}

/** Único lugar donde se decide qué adaptador recibe cada caso de uso. */
export function casosDeUso(): CasosDeUso {
  if (!casos) {
    const dynamo = configDynamoDesdeEntorno();
    const pases = configPasesDesdeEntorno();
    const doc = crearClienteDynamo(dynamo);
    const reloj = () => new Date();
    const accesos = new RegistroAccesoDynamo(doc, dynamo.tabla);
    const visitasYPases = new VisitaPaseDynamo(doc, dynamo.tabla);
    const registrarAcceso = new RegistrarAcceso(accesos, reloj, randomUUID);
    casos = {
      registrarAcceso,
      sincronizarLote: new SincronizarLote(registrarAcceso),
      registrarVisita: new RegistrarVisita({
        repositorio: visitasYPases,
        unidades: new UnidadesGestion(pases.gestionUrl),
        reloj,
        nuevoId: randomUUID,
        nuevoCodigoPase,
        ventana: pases.ventana,
      }),
      validarPase: new ValidarPase(visitasYPases, reloj),
      pasesParaGuardia: new PasesParaGuardia(visitasYPases, reloj, pases.desfaseMinutos),
      listarPlacas: new ListarPlacas(new PlacasDynamo(doc, dynamo.tabla)),
    };
  }
  return casos;
}
