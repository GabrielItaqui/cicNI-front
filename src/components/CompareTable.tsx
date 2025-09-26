import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

type FlatRow = {
  ordem: string | number;
  ncm: string;
  descricao: string;
  qtd: string | number;
  unidade: string;
  valor: string | number;
  key: string;
  code?: string;
};

type CompareTableProps = {
  co?: any;
  fc?: any;
  showOnlyDiffs?: boolean;
  loading?: boolean;
  onToggleOnlyDiffs?: (v: boolean) => void;
};

type CmpState = "ok" | "warn" | "miss";

type SortKey =
  | "ordem"
  | "ncmCO"
  | "ncmFC"
  | "descCO"
  | "descFC"
  | "qtdCO"
  | "qtdFC"
  | "unCO"
  | "unFC"
  | "valCO"
  | "valFC";

export default function CompareTable({
  co,
  fc,
  showOnlyDiffs: showOnlyDiffsProp,
  loading = false,
  onToggleOnlyDiffs,
}: CompareTableProps) {
  const [internalOnlyDiffs, setInternalOnlyDiffs] = useState(false);
  const showOnlyDiffs = showOnlyDiffsProp ?? internalOnlyDiffs;
  const toggleOnlyDiffs = (v: boolean) => {
    if (onToggleOnlyDiffs) onToggleOnlyDiffs(v);
    else setInternalOnlyDiffs(v);
  };

  const [sortKey, setSortKey] = useState<SortKey>("ordem");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const coRows = useMemo(() => flattenCO(co), [co]);
  const fcRows = useMemo(() => flattenFC(fc), [fc]);

  // Agregar por NCM (para visões/totais – não usado no match)
  const aggregatedCORows = useMemo(() => aggregateByNCM(coRows), [coRows]);
  const aggregatedFCRows = useMemo(() => aggregateByNCM(fcRows), [fcRows]);

  const mergedRaw = useMemo(() => {
    // ===== índices FC (CRU) por código, primeiro token, NCM
    const usedFC = new Set<FlatRow>();

    const normalizeNoAccentUpper = (s: string) =>
      s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toUpperCase().trim();

    const stripLeadingCode = (s: string) => s.replace(/^\s*0*\d{5,}\b[:\-]?\s*/, "");

    const firstToken = (desc?: string) => {
      if (!desc) return "";
      const t = normalizeNoAccentUpper(stripLeadingCode(String(desc)));
      return (t.split(/[^A-Z0-9]+/).filter(Boolean)[0] ?? "");
    };

    const tokens = (desc?: string): string[] => {
      if (!desc) return [];
      const t = normalizeNoAccentUpper(stripLeadingCode(String(desc)));
      return t.split(/[^A-Z0-9]+/).filter(Boolean);
    };

    const toNum = (v: unknown) => toNumberSafe(v);

    function buildIndexes(rows: FlatRow[]) {
      const byCode = new Map<string, FlatRow[]>();
      const byFirstTok = new Map<string, FlatRow[]>();
      const byNcm = new Map<string, FlatRow[]>();

      for (const r of rows) {
        const code = normalizeCode(r.code);
        const tok = firstToken(r.descricao);
        const ncm = normalizeStr(r.ncm);

        if (code) byCode.set(code, (byCode.get(code) || []).concat(r));
        if (tok) byFirstTok.set(tok, (byFirstTok.get(tok) || []).concat(r));
        if (ncm) byNcm.set(ncm, (byNcm.get(ncm) || []).concat(r));
      }
      return { byCode, byFirstTok, byNcm };
    }

    const fcIdx = buildIndexes(fcRows);

    // ===== desempate com prioridade: NCM > CÓDIGO > tokens(1,2,3) > ΔQTD > ΔVALOR
    const pickBestCandidate = (cands: FlatRow[], co: FlatRow) => {
      const ct = tokens(co.descricao);
      const ncmCO = normalizeStr(co.ncm);
      const codeCO = normalizeCode(co.code);

      let best = cands[0];
      let bestTuple: [number, number, number, number, number, number, number] = [-1, -1, -1, -1, -1, -Infinity, -Infinity];

      for (const fc of cands) {
        const ft = tokens(fc.descricao);
        const ncmMatch = normalizeStr(fc.ncm) === ncmCO ? 1 : 0;

        // código forte: se ambos tiverem e forem iguais, 1; senão, 0
        const codeFC = normalizeCode(fc.code);
        const codeMatch = codeCO && codeFC && codeCO === codeFC ? 1 : 0;

        const m0 = ct[0] && ft[0] && ct[0] === ft[0] ? 1 : 0;
        const m1 = ct[1] && ft[1] && ct[1] === ft[1] ? 1 : 0;
        const m2 = ct[2] && ft[2] && ct[2] === ft[2] ? 1 : 0;

        const dq = -Math.abs(toNum(co.qtd) - toNum(fc.qtd));    // quanto menor a diferença, melhor
        const dv = -Math.abs(toNum(co.valor) - toNum(fc.valor)); // idem para valor

        const tup: [number, number, number, number, number, number, number] = [
          ncmMatch, codeMatch, m0, m1, m2, dq, dv
        ];

        // comparação lexicográfica
        let better = false;
        for (let k = 0; k < tup.length; k++) {
          if (tup[k] > bestTuple[k]) { better = true; break; }
          if (tup[k] < bestTuple[k]) { better = false; break; }
        }
        if (better) { bestTuple = tup; best = fc; }
      }

      // devolve também em qual "modo" predominante casou (para pintar e comparar descrição)
      const mode: "code" | "ncm" | "name" =
        (normalizeCode(co.code) && normalizeCode(best.code) && normalizeCode(co.code) === normalizeCode(best.code))
          ? "code"
          : (normalizeStr(best.ncm) === normalizeStr(co.ncm) ? "ncm" : "name");

      return { best, mode };
    };

    // utilitário para unir listas com deduplicação
    const uniqueMerge = (...lists: FlatRow[][]) => {
      const seen = new Set<FlatRow>();
      const out: FlatRow[] = [];
      for (const list of lists) {
        for (const r of list) {
          if (!seen.has(r)) { seen.add(r); out.push(r); }
        }
      }
      return out;
    };

    type OutRow = {
      key?: string;
      ordem: string | number;
      ncmCO: string;
      ncmFC: string;
      descCO: string;
      descFC: string;
      qtdCO: string | number;
      unCO: string;
      qtdFC: string | number;
      unFC: string;
      valCO: string | number;
      valFC: string | number;
      codeCO?: string;
      codeFC?: string;
      matchMode?: "code" | "name" | "ncm" | "leftover";
    };

    const out: OutRow[] = [];

    // ===== casamento CO → FC obedecendo: NCM > CÓDIGO > tokens(1,2,3) > ΔQTD > ΔVALOR
    for (const rCO of coRows) {
      const ncmCO = normalizeStr(rCO.ncm);
      const tokCO = firstToken(rCO.descricao);
      const codeCO = normalizeCode(rCO.code);

      // candidatos prioritários
      const poolNcm = (fcIdx.byNcm.get(ncmCO) || []).filter((r) => !usedFC.has(r));
      const poolCode = codeCO ? (fcIdx.byCode.get(codeCO) || []).filter((r) => !usedFC.has(r)) : [];
      const poolTok = tokCO ? (fcIdx.byFirstTok.get(tokCO) || []).filter((r) => !usedFC.has(r)) : [];

      // união (mantém ordem de prioridade implícita, mas o desempate final é pela tupla)
      let pool = uniqueMerge(poolNcm, poolCode, poolTok);

      // fallback extremo: se vazio, considera qualquer FC ainda não usado
      if (!pool.length) pool = fcRows.filter((r) => !usedFC.has(r));

      let rFC: FlatRow | undefined;
      let mode: OutRow["matchMode"] = undefined;

      if (pool.length) {
        const { best, mode: m } = pickBestCandidate(pool, rCO);
        rFC = best;
        mode = m;
      }

      if (rFC) usedFC.add(rFC);

      out.push({
        key: rCO.key || rFC?.key,
        ordem: rCO.ordem ?? rFC?.ordem ?? "",
        ncmCO: rCO.ncm ?? "",
        ncmFC: rFC?.ncm ?? "",
        descCO: rCO.descricao ?? "",
        descFC: rFC?.descricao ?? "",
        qtdCO: rCO.qtd ?? "",
        unCO: rCO.unidade ?? "",
        qtdFC: rFC?.qtd ?? "",
        unFC: rFC?.unidade ?? "",
        valCO: rCO.valor ?? "",
        valFC: rFC?.valor ?? "",
        codeCO: rCO.code,
        codeFC: rFC?.code,
        matchMode: mode ?? "name",
      });
    }

    // 4) SOBRAS FC (não casadas)
    for (const rFC of fcRows) {
      if (usedFC.has(rFC)) continue;
      out.push({
        key: rFC.key,
        ordem: rFC.ordem ?? "",
        ncmCO: "",
        ncmFC: rFC.ncm ?? "",
        descCO: "",
        descFC: rFC.descricao ?? "",
        qtdCO: "",
        unCO: "",
        qtdFC: rFC.qtd ?? "",
        unFC: rFC.unidade ?? "",
        valCO: "",
        valFC: rFC.valor ?? "",
        codeCO: undefined,
        codeFC: rFC.code,
        matchMode: "leftover",
      });
    }

    return out;
  }, [coRows, fcRows]);

  // ===== AGRUPAMENTO VISUAL (sem somar / sem remover linhas)
  const mergedGrouped = useMemo(() => groupMergedRows(mergedRaw), [mergedRaw]);

  const withStatus = useMemo(() => {
    return mergedGrouped.map((r) => {
      const sNcm: CmpState = cmpText(r.ncmCO, r.ncmFC);

      let sDesc: CmpState;
      if (r.matchMode === "code") {
        sDesc = cmpCode(r.codeCO, r.codeFC);
      } else {
        const stripLeadingCode = (s: string) => s.replace(/^\s*0*\d{5,}\b[:\-]?\s*/, "");
        const tk = (s?: string) =>
          normalizeStr(String(s ?? ""))
            .replace(/^\s*0*\d{5,}\b[:\-]?\s*/, "")
            .split(/[^A-Z0-9]+/)
            .filter(Boolean);

        const tCO = tk(stripLeadingCode(r.descCO));
        const tFC = tk(stripLeadingCode(r.descFC));
        const m0 = !!tCO[0] && tCO[0] === tFC[0];
        const m1 = !!tCO[1] && tCO[1] === tFC[1];
        const m2 = !!tCO[2] && tCO[2] === tFC[2];

        sDesc = m0 && m1 ? "ok" : (m0 || m1 || m2) ? "warn" : "miss";
      }

      const sQtd: CmpState = cmpNumber(r.qtdCO, r.qtdFC, 1e-6);
      const sUn: CmpState = cmpUnit(r.unCO, r.unFC);
      const sVal: CmpState = cmpMoney(r.valCO, r.valFC);

      const states = { ncm: sNcm, desc: sDesc, qtd: sQtd, un: sUn, val: sVal };
      const worst = worstState(states);
      const hasDiff = Object.values(states).some((s) => s !== "ok");
      const isAllOk = !hasDiff;
      return { ...r, states, worst, hasDiff, isAllOk };
    });
  }, [mergedGrouped]);

  const counters = useMemo(() => {
    let ok = 0,
      warn = 0,
      miss = 0;
    for (const row of withStatus) {
      for (const s of Object.values(row.states!)) {
        if (s === "ok") ok++;
        else if (s === "warn") warn++;
        else miss++;
      }
    }
    return { ok, warn, miss, total: ok + warn + miss };
  }, [withStatus]);

  const filtered = useMemo(
    () => (showOnlyDiffs ? withStatus.filter((r) => r.hasDiff) : withStatus),
    [withStatus, showOnlyDiffs]
  );

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = (a as any)[sortKey];
      const vb = (b as any)[sortKey];
      const na = toNumberSafe(va);
      const nb = toNumberSafe(vb);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && (na || nb)) {
        return (na - nb) * sortDir;
      }
      const sa = normalizeStr(va);
      const sb = normalizeStr(vb);
      return sa.localeCompare(sb) * sortDir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  const exportDiffsXlsx = () => {
    const diffs = withStatus.filter((r) => r.hasDiff);
    const rows = diffs.map((r) => ({
      ordem: r.ordem,
      ncmCO: r.ncmCO,
      ncmFC: r.ncmFC,
      descCO: r.descCO,
      descFC: r.descFC,
      codeCO: r.codeCO ?? "",
      codeFC: r.codeFC ?? "",
      qtdCO: r.qtdCO,
      unCO: r.unCO,
      qtdFC: r.qtdFC,
      unFC: r.unFC,
      valCO: r.valCO,
      valFC: r.valFC,
      statusLinha: r.worst,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "divergencias");
    XLSX.writeFile(wb, `divergencias_${Date.now()}.xlsx`);
  };

  return (
    <div className="table-container">
      <div className="cmp-toolbar">
        <div className="cmp-legend">
          <span className="pill pill-ok" title="Campos iguais (verde)">
            ✓ {counters.ok}
          </span>
          <span className="pill pill-warn" title="Campos diferentes (amarelo)">
            ≠ {counters.warn}
          </span>
          <span className="pill pill-miss" title="Campos ausentes (vermelho)">
            ∅ {counters.miss}
          </span>
          <span className="pill" title="Total de campos avaliados">
            Σ {counters.total}
          </span>
        </div>
        <div className="cmp-right">
          <label className="cmp-toggle">
            <input
              type="checkbox"
              checked={!!showOnlyDiffs}
              onChange={(e) => toggleOnlyDiffs(e.target.checked)}
            />
            Mostrar apenas divergências
          </label>
          <button
            className="btn"
            onClick={exportDiffsXlsx}
            disabled={!withStatus.some((r) => r.hasDiff)}
          >
            Exportar divergências (.xlsx)
          </button>
        </div>
      </div>

      <div className="table-scroll">
        <table className="table">
          <colgroup>
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "5%" }} />
            <col style={{ width: "7.5%" }} />
            <col style={{ width: "7.5%" }} />
          </colgroup>
          <thead className="sticky-header">
            <tr>
              <Th label="Nº de Ordem" onClick={() => onSort("ordem")} sticky />
              <Th label="NCM CO" onClick={() => onSort("ncmCO")} />
              <Th label="NCM FC" onClick={() => onSort("ncmFC")} />
              <Th label="Descricao CO" onClick={() => onSort("descCO")} wide />
              <Th label="Descricao FC" onClick={() => onSort("descFC")} wide />
              <Th label="QTD CO" onClick={() => onSort("qtdCO")} right />
              <Th label="Unidade CO" onClick={() => onSort("unCO")} />
              <Th label="QTD FC" onClick={() => onSort("qtdFC")} right />
              <Th label="Unidade FC" onClick={() => onSort("unFC")} />
              <Th label="Valor CO" onClick={() => onSort("valCO")} right />
              <Th label="Valor FC" onClick={() => onSort("valFC")} right />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              renderSkeleton()
            ) : sorted.length ? (
              sorted.map((r, i) => {
                const domKey = [
                  r.key ?? "",
                  r.ncmCO ?? "",
                  r.ncmFC ?? "",
                  r.qtdCO ?? "",
                  r.qtdFC ?? "",
                  r.unCO ?? "",
                  r.unFC ?? "",
                  r.valCO ?? "",
                  r.valFC ?? "",
                ]
                  .join("|")
                  .replace(/\s+/g, "_");

                return (
                  <tr
                    key={`row-${domKey}-${i}`}
                    className={
                      r.worst === "miss" ? "row-miss" : r.worst === "warn" ? "row-warn" : "row-ok"
                    }
                  >
                    <td className="td sticky-col">{r.ordem}</td>

                    <td className={`td cmp ${cls(r.states!.ncm)}`}>{r.ncmCO}</td>
                    <td className={`td cmp ${cls(r.states!.ncm)}`}>{r.ncmFC}</td>

                    <td className={`td cmp wrap ${cls(r.states!.desc)}`}>{r.descCO}</td>
                    <td className={`td cmp wrap ${cls(r.states!.desc)}`}>{r.descFC}</td>

                    <td className={`td td-right nowrap cmp ${cls(r.states!.qtd)}`}>{r.qtdCO}</td>
                    <td className={`td td-center cmp ${cls(r.states!.un)}`}>{r.unCO}</td>

                    <td className={`td td-right nowrap cmp ${cls(r.states!.qtd)}`}>{r.qtdFC}</td>
                    <td className={`td td-center cmp ${cls(r.states!.un)}`}>{r.unFC}</td>

                    <td className={`td td-right nowrap cmp ${cls(r.states!.val)}`}>
                      {formatMaybeCurrency(r.valCO)}
                    </td>
                    <td className={`td td-right nowrap cmp ${cls(r.states!.val)}`}>
                      {formatMaybeCurrency(r.valFC)}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="td" colSpan={11}>
                  Sem dados. Envie CO e/ou FC no topo.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================== Subcomponentes ================== */

function Th({
  label,
  onClick,
  right,
  wide,
  sticky,
}: {
  label: string;
  onClick?: () => void;
  right?: boolean;
  wide?: boolean;
  sticky?: boolean;
}) {
  return (
    <th
      className={`th ${right ? "th-right" : ""} ${wide ? "th-wide" : ""} ${sticky ? "sticky-col" : ""
        }`}
      onClick={onClick}
      title="Clique para ordenar"
      role="button"
    >
      {label}
      <span className="th-sort-hint">↕</span>
    </th>
  );
}

/* ================= Funções de agregação ================= */
// Corrigida: não altera key/descricao; serve apenas para somar por NCM.
function aggregateByNCM(rows: FlatRow[]): FlatRow[] {
  const map = new Map<string, FlatRow>();

  for (const row of rows) {
    const ncm = normalizeStr(row.ncm);
    if (!ncm) continue;

    const existing = map.get(ncm);
    if (existing) {
      existing.qtd = toNumberSafe(existing.qtd) + toNumberSafe(row.qtd);
      existing.valor = toNumberSafe(existing.valor) + toNumberSafe(row.valor);
    } else {
      map.set(ncm, {
        ...row,
        // Mantém key/descricao originais
        key: row.key,
        descricao: row.descricao,
      });
    }
  }
  return Array.from(map.values());
}

/* ================= Helpers ================= */

/** Aceita { data: { itens: [...] } } ou { itens: [...] } ou { data: { items: [...] } } */
function getItemsFromPayload(payload: any): any[] {
  const data = payload?.data ?? payload;
  const itens = data?.itens ?? data?.items ?? [];
  return Array.isArray(itens) ? itens : [];
}

function pickDesc(it: any): string {
  return (it?.produto ?? it?.nomeProduto ?? it?.descricao ?? "").toString().trim();
}

function pickCode(it: any): string {
  const raw = (it?.codigoInterno ?? it?.codigo ?? it?.cod ?? it?.codigo_produto ?? "")
    .toString()
    .trim();
  return raw.replace(/^0+(?=\d)/, "");
}

function pickQtd(it: any): string | number {
  return it?.qtd ?? it?.quantidade ?? it?.quantity ?? "";
}

function pickValor(it: any): string | number {
  return (
    it?.valor ??
    it?.precoUnit ??
    it?.preco_unit ??
    it?.valorUnitario ??
    it?.preco_total ??
    ""
  );
}

function sanitizeNcm(ncm: any): string {
  return (ncm ?? "").toString().replace(/\./g, "");
}

function rowKeyFromItem(it: any): string {
  const codigo = pickCode(it);
  if (codigo) return codigo;

  const ordem = (it?.ordem ?? it?.order ?? "").toString().trim();
  const ncm = sanitizeNcm(it?.ncm);
  const page = it?.page ?? "";
  const yline = it?.y_line ?? "";
  const desc = pickDesc(it);

  const fallbackA = [ordem, ncm].filter(Boolean).join("|");
  const fallbackB = page || yline ? `${page}-${yline}` : "";

  const idOrA = it?.id ?? fallbackA;
  const base = idOrA || fallbackB;

  const finalKey = base || desc.slice(0, 24) || "row";
  return String(finalKey);
}

function flattenCO(resp: any): FlatRow[] {
  const itens = getItemsFromPayload(resp);
  if (!Array.isArray(itens)) return [];
  return itens.map((it: any) => {
    const code = pickCode(it);
    const name = pickDesc(it);
    const descricaoCO = `${code ? code + " " : ""}${name}`.trim();
    return {
      ordem: it?.ordem ?? "",
      ncm: sanitizeNcm(it?.ncm),
      descricao: descricaoCO,
      qtd: pickQtd(it),
      unidade: it?.unidade ?? "",
      valor: pickValor(it),
      key: rowKeyFromItem(it),
      code,
    };
  });
}

function flattenFC(resp: any): FlatRow[] {
  const itens = getItemsFromPayload(resp);
  if (!Array.isArray(itens)) return [];
  return itens.map((it: any) => {
    const code = pickCode(it);
    return {
      ordem: it?.ordem ?? "",
      ncm: sanitizeNcm(it?.ncm),
      descricao: pickDesc(it) || (it?.descricao ?? ""),
      qtd: pickQtd(it),
      unidade: it?.unidade ?? "",
      valor: pickValor(it),
      key: rowKeyFromItem(it),
      code,
    };
  });
}

function toNumberSafe(v: unknown): number {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
}

function formatMaybeCurrency(v: string | number): string | number {
  const n = toNumberSafe(v);
  return n ? formatCurrency(n) : typeof v === "string" ? v : n;
}

function normalizeStr(v: unknown): string {
  const s = String(v ?? "");
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function normalizeCode(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.replace(/^0+(?=\d)/, "").toUpperCase();
}

function cmpText(a: unknown, b: unknown): CmpState {
  if (isEmpty(a) && isEmpty(b)) return "miss";
  if (isEmpty(a) || isEmpty(b)) return "miss";
  return normalizeStr(a) === normalizeStr(b) ? "ok" : "warn";
}

function cmpCode(a: unknown, b: unknown): CmpState {
  if (isEmpty(a) && isEmpty(b)) return "miss";
  if (isEmpty(a) || isEmpty(b)) return "miss";
  return normalizeCode(a) === normalizeCode(b) ? "ok" : "warn";
}

function cmpUnit(a: unknown, b: unknown): CmpState {
  return cmpText(String(a).replace(/\./g, ""), String(b).replace(/\./g, ""));
}

function cmpNumber(a: unknown, b: unknown, tol = 0.000001): CmpState {
  const na = toNumberSafe(a);
  const nb = toNumberSafe(b);
  if (!na && !nb && (isEmpty(a) || isEmpty(b))) return "miss";
  if ((isEmpty(a) && !nb) || (isEmpty(b) && !na)) return "miss";
  return Math.abs(na - nb) <= tol ? "ok" : "warn";
}

function cmpMoney(a: unknown, b: unknown, tol = 0.005): CmpState {
  return cmpNumber(a, b, tol);
}

function worstState(o: Record<string, CmpState>): CmpState {
  if (Object.values(o).some((s) => s === "miss")) return "miss";
  if (Object.values(o).some((s) => s === "warn")) return "warn";
  return "ok";
}

function cls(s: CmpState): string {
  return s === "ok" ? "cmp-ok" : s === "warn" ? "cmp-warn" : "cmp-miss";
}

//  ============== AGRUPAMENTO VISUAL (sem somar / sem remover) ==============

type MergedRow = {
  key?: string;
  ordem: string | number;
  ncmCO: string;
  ncmFC: string;
  descCO: string;
  descFC: string;
  qtdCO: string | number;
  unCO: string;
  qtdFC: string | number;
  unFC: string;
  valCO: string | number;
  valFC: string | number;
  codeCO?: string;
  codeFC?: string;
  matchMode?: "code" | "name" | "ncm" | "leftover";
};

function groupMergedRows(rows: MergedRow[]): MergedRow[] {
  const map = new Map<string, MergedRow>();

  const stripLeadingCode = (s: string) => (s || "").replace(/^\s*0*\d{5,}\b[:\-]?\s*/, "");
  const canonNameFull = (s?: string) => normalizeStr(stripLeadingCode(String(s ?? "")));

  const softKey = (r: MergedRow) => {
    // Chave PRIMÁRIA: apenas o CO (nome + NCM) — é isso que determina o merge
    const nameCO = canonNameFull(r.descCO);
    const ncmCO = normalizeStr(r.ncmCO);

    // Fallback: se CO vier vazio, usamos FC para não perder colapsos raros
    const nameFC = canonNameFull(r.descFC);
    const ncmFC = normalizeStr(r.ncmFC);

    // Gate de código: conjunto ordem-independente; se houver, precisa ser igual
    const codeSet = [normalizeCode(r.codeCO), normalizeCode(r.codeFC)]
      .filter(Boolean)
      .sort()
      .join("+");
    const codeGate = codeSet ? `|CODE:${codeSet}` : "";

    if (nameCO || ncmCO) {
      return `CO:${nameCO}|${ncmCO}${codeGate}`;
    }
    return `FC:${nameFC}|${ncmFC}${codeGate}`;
  };

  const joinField = (a?: string | number, b?: string | number) => {
    const A = (a ?? "").toString().trim();
    const B = (b ?? "").toString().trim();
    if (!A) return B;
    if (!B) return A;
    return A === B ? A : `${A}, ${B}`;
  };

  for (const r of rows) {
    const k = softKey(r);
    const found = map.get(k);
    if (found) {
      // não somar; apenas colapsar visualmente e preservar informações não vazias
      found.ordem = joinField(found.ordem, r.ordem);
      found.key = joinField(found.key, r.key) as string;

      if (!found.descCO && r.descCO) found.descCO = r.descCO;
      if (!found.descFC && r.descFC) found.descFC = r.descFC;
      if (!found.ncmCO && r.ncmCO) found.ncmCO = r.ncmCO;
      if (!found.ncmFC && r.ncmFC) found.ncmFC = r.ncmFC;
      if (!found.unCO && r.unCO) found.unCO = r.unCO;
      if (!found.unFC && r.unFC) found.unFC = r.unFC;
      if (!found.codeCO && r.codeCO) found.codeCO = r.codeCO as string;
      if (!found.codeFC && r.codeFC) found.codeFC = r.codeFC as string;
      if (!found.matchMode && r.matchMode) found.matchMode = r.matchMode;
    } else {
      map.set(k, { ...r });
    }
  }

  return Array.from(map.values());
}

/* skeleton loader */
function renderSkeleton() {
  const cols = 11;
  const rows = 10;
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((__, j) => (
            <td key={j} className={`td ${j === 0 ? "sticky-col" : ""}`}>
              <div className="skeleton" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
