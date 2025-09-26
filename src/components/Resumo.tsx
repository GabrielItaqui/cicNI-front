import React, { useMemo } from "react";

type ResumoProps = {
  co?: any | null;
  fc?: any | null;
};

type MiniItem = {
  quantidade: number | null;
  unidade: string | null;
  total: number | null;
};

function toNumberSafe(x: any): number {
  if (x == null) return NaN;
  if (typeof x === "number") return isFinite(x) ? x : NaN;
  if (typeof x === "string") {
    // remove separador de milhar, normaliza decimal e limpa símbolos
    const s = x.replace(/\./g, "").replace(",", ".").replace(/[^\d\.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : NaN;
  }
  return NaN;
}

function normalizeUnit(u: any): string {
  if (!u) return "";
  const s = String(u).trim().toUpperCase();
  if (["UND", "UNID", "UN.", "UNIDADE"].includes(s)) return "UN";
  if (["MTS", "MT"].includes(s)) return "M";
  if (["KILO", "KILOS"].includes(s)) return "KG";
  return s;
}

function pickFirstNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      const n = toNumberSafe(v);
      if (isFinite(n)) return n;
    }
  }
  return null;
}

function pickFirstString(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return null;
}

// CO: resp.data.ordens[].ncms[].itens[]
function extractCOItems(resp: any): MiniItem[] {
  const ordens = resp?.data?.ordens;
  const out: MiniItem[] = [];
  if (Array.isArray(ordens)) {
    for (const ordemEntry of ordens) {
      const ncms = ordemEntry?.ncms || [];
      for (const n of ncms) {
        const itens = n?.itens || [];
        for (const it of itens) {
          // total: aceita chaves comuns no CO também
          const total = pickFirstNumber(it, [
            "valor",
            "preco_total",
            "valor_total",
            "total",
            "pt",
          ]);
          const quantidade =
            pickFirstNumber(it, ["quantidade", "qtd", "qty", "qtde"]);
          const unidade =
            pickFirstString(it, ["unidade", "un", "uni", "unidad"]) ?? null;

          out.push({
            quantidade: quantidade,
            unidade: unidade,
            total: total,
          });
        }
      }
    }
  }
  return out;
}

// FC: normalmente resp.itens[], mas pode vir em resp.data.itens
function getFCItensArray(resp: any): any[] {
  if (Array.isArray(resp?.itens)) return resp.itens;
  if (Array.isArray(resp?.data?.itens)) return resp.data.itens;
  return [];
}

function extractFCItems(resp: any): MiniItem[] {
  const itens = getFCItensArray(resp);
  if (!Array.isArray(itens)) return [];
  return itens.map((it: any) => {
    const total = pickFirstNumber(it, [
      // tente do mais comum ao menos comum
      "valor",
      "preco_total",
      "valor_total",
      "precoTotal",
      "valorTotal",
      "total",
      "pt",
      "preco_total_extraido",
      "preco_total_txt",
    ]);
    const quantidade = pickFirstNumber(it, [
      "quantidade",
      "qtd",
      "qty",
      "qtde",
    ]);
    const unidade =
      pickFirstString(it, ["unidade", "un", "uni", "unidad"]) ?? null;

    return {
      quantidade,
      unidade,
      total,
    };
  });
}

function formatCurrency(n: number, currency: string = "BRL") {
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(n);
  } catch {
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }
}

function formatNumber(n: number) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function useResumoData(co?: any | null, fc?: any | null) {
  return useMemo(() => {
    const coItems = co ? extractCOItems(co) : [];
    const fcItems = fc ? extractFCItems(fc) : [];

    // moeda: tentar várias chaves comuns no meta
    const currencyCO =
      pickFirstString(co?.meta, ["moeda", "currency", "moneda"]) || "BRL";
    const currencyFC =
      pickFirstString(fc?.meta, ["moeda", "currency", "moneda"]) || "BRL";

    const sumValues = (arr: MiniItem[]) => {
      let sum = 0;
      let withVal = 0;
      for (const it of arr) {
        const v = it.total;
        if (v != null && isFinite(v)) {
          sum += v;
          withVal++;
        }
      }
      return { sum, withVal, totalItems: arr.length };
    };

    const groupUnits = (arr: MiniItem[]) => {
      const m = new Map<string, number>();
      for (const it of arr) {
        const u = normalizeUnit(it.unidade);
        const q = it.quantidade;
        if (!u) continue;
        if (q == null || !isFinite(q)) continue;
        m.set(u, (m.get(u) || 0) + q);
      }
      // determinismo: ordenar por unidade
      return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    };

    const coVals = sumValues(coItems);
    const fcVals = sumValues(fcItems);
    const coUnits = groupUnits(coItems);
    const fcUnits = groupUnits(fcItems);

    return { currencyCO, currencyFC, coVals, fcVals, coUnits, fcUnits };
  }, [co, fc]);
}

const Resumo: React.FC<ResumoProps> = ({ co, fc }) => {
  const { currencyCO, currencyFC, coVals, fcVals, coUnits, fcUnits } =
    useResumoData(co, fc);
  const hasAny = coVals.totalItems > 0 || fcVals.totalItems > 0;
  if (!hasAny) return null;

  return (
    <div className="summary-card" role="region" aria-label="Resumo comparativo">
      <div className="summary-grid">
        <section className="summary-section">
          <div className="summary-title">Valor total CO</div>
          <div className="summary-total">
            {coVals.withVal ? formatCurrency(coVals.sum, currencyCO) : "—"}
          </div>
          <div className="summary-hint">
            Itens com valor: {coVals.withVal}/{coVals.totalItems}
          </div>
        </section>

        <section className="summary-section">
          <div className="summary-title">Valor total FC</div>
          <div className="summary-total">
            {fcVals.withVal ? formatCurrency(fcVals.sum, currencyFC) : "—"}
          </div>
          <div className="summary-hint">
            Itens com valor: {fcVals.withVal}/{fcVals.totalItems}
          </div>
        </section>
      </div>

      <div className="summary-grid">
        <section className="summary-section">
          <div className="summary-title">Quantidade total CO</div>
          <div className="unit-chips">
            {coUnits.length ? (
              coUnits.map(([u, q]) => (
                <span key={u} className="unit-chip">
                  {u} {formatNumber(q)}
                </span>
              ))
            ) : (
              <span className="summary-hint">—</span>
            )}
          </div>
        </section>

        <section className="summary-section">
          <div className="summary-title">Quantidade total FC</div>
          <div className="unit-chips">
            {fcUnits.length ? (
              fcUnits.map(([u, q]) => (
                <span key={u} className="unit-chip">
                  {u} {formatNumber(q)}
                </span>
              ))
            ) : (
              <span className="summary-hint">—</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Resumo;
