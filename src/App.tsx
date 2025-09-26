import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import Header from "./components/Header";
import CompareTable from "./components/CompareTable";
import "./App.css";
import Resumo from "./components/Resumo"

// === Tipos ===
type ItemRow = {
  ordem: string | number;
  ncm: string;
  descricao: string;
  produto: string;
  qtd: string | number;
  unidade: string;
  valor: string | number;
};

// Endpoints padrão (podem ser sobrescritos por VITE_API_URL e VITE_API_URL_FC)
const CO_DEFAULT =
  (import.meta.env.VITE_API_URL as string | undefined)?.toString() ||
  "http://56.125.86.240:8000/v1/co/parse";
const FC_DEFAULT =
  (import.meta.env.VITE_API_URL_FC as string | undefined)?.toString() ||
  "http://56.125.86.240:8000/v1/fc/parse";

export default function App() {
  // Endpoints editáveis pelo Header (⚙️)
  const [coEndpoint, setCoEndpoint] = useState<string>(CO_DEFAULT);
  const [fcEndpoint, setFcEndpoint] = useState<string>(FC_DEFAULT);

  // Arquivos enviados (para habilitar Download XML no Header)
  const [coFile, setCoFile] = useState<File | null>(null);
  const [fcFile, setFcFile] = useState<File | null>(null);

  // [IR_CHANGE] Adiciona o estado para o perfil do CO
  const [coProfile, setCoProfile] = useState("co_ace72");
  // Perfil da FC (valor exato que o back espera)
  const [fcProfile, setFcProfile] = useState("fc_marcopolo");

  // JSONs brutos para a tabela comparativa
  const [coJson, setCoJson] = useState<any | null>(null);
  const [fcJson, setFcJson] = useState<any | null>(null);

  // Estado da tabela para export .xlsx
  const [rows, setRows] = useState<ItemRow[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [loadingCo, setLoadingCo] = useState(false);
  const [loadingFc, setLoadingFc] = useState(false);

  const totalValor = useMemo(
    () => rows.reduce((acc, r) => acc + toNumberSafe(r.valor), 0),
    [rows]
  );

  const canDownloadXml = !!(coFile && fcFile);

  // === Handlers do Header ===
  const onUploadCO = async (file: File, profile: string) => {
    try {
      setError(null);
      validatePdf(file);
      setCoFile(file);
      setLoadingCo(true);

      // [IR_CHANGE] Chamada ao helper com o perfil
      const json = await postCOFileAndGetJson(coEndpoint, file, profile);

      console.log(json)

      setCoJson(json);

      // mantém o flatten atual para o export .xlsx existente
      const flattened = flattenResponseToRows(json);
      setRows(flattened);
    } catch (e: any) {
      setError(e?.message || "Falha ao processar CO.");
    } finally {
      setLoadingCo(false);
    }
  };

  const onUploadFC = async (file: File, profile: string) => {
    try {
      setError(null);
      validatePdf(file);
      setFcFile(file);
      setLoadingFc(true);

      // chamada específica da FC ("pdf" + "profile")
      const json = await postFCFileAndGetJson(fcEndpoint, file, profile);

      console.log(json);

      setFcJson(json);

      // mantém o flatten atual para o export .xlsx existente
      const flattened = flattenResponseToRows(json);
      setRows(flattened);
    } catch (e: any) {
      setError(e?.message || "Falha ao processar FC.");
    } finally {
      setLoadingFc(false);
    }
  };

  const onDownloadXml = () => {
    // placeholder — decidir se gera no front a partir de coJson/fcJson ou chama /v1/compare/xml
    alert("Baixar XML (placeholder).");
  };

  // === Ações locais (definido ANTES do return) ===
  const downloadXlsx = () => {
    if (!rows.length) return;
    const sheetData = [
      ["Nº de Ordem", "NCM", "Descrição", "Produto", "QTD", "Unidade", "Valor"],
      ...rows.map((r) => [
        r.ordem,
        r.ncm,
        r.descricao,
        r.produto,
        r.qtd,
        r.unidade,
        r.valor,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Itens");
    XLSX.writeFile(wb, `itens_${Date.now()}.xlsx`);
  };

  // === Render ===
  return (
    <div className="app-container">
      <h1 className="app-title">CO/FC Itens — Visualizador</h1>
      <p className="app-subtitle">
        Envie o CO e a FC pelo header. Depois, exporte os itens em .xlsx.
      </p>

      <Header
        coEndpoint={coEndpoint}
        fcEndpoint={fcEndpoint}
        onChangeCoEndpoint={setCoEndpoint}
        onChangeFcEndpoint={setFcEndpoint}
        onUploadCO={onUploadCO}
        onUploadFC={onUploadFC}
        canDownloadXml={canDownloadXml}
        onDownloadXml={onDownloadXml}
        coUploaded={!!coFile}
        fcUploaded={!!fcFile}
        fcProfile={fcProfile}
        // [IR_CHANGE] Passa o perfil e o callback de mudança para o Header
        coProfile={coProfile}
        onChangeCoProfile={setCoProfile}
        availableProfiles={["co_ace72", "fc_marcopolo", "fc_foca"]}
        onChangeFcProfile={setFcProfile}
      />

      {error && (
        <div className="error-box">
          <strong>Erro:</strong> {error}
        </div>
      )}

      <div className="actions-row">
        <div className="summary">
          {loadingCo && <span>Processando CO… </span>}
          {loadingFc && <span>Processando FC… </span>}
          {rows.length ? (
            <>
              <b>{rows.length}</b> linha(s) · Total:{" "}
              <b>{formatCurrency(totalValor)}</b>
            </>
          ) : (
            <>Sem dados. Envie um CO ou FC no topo.</>
          )}
        </div>

        <button className="btn" onClick={downloadXlsx} disabled={!rows.length}>
          Baixar .xlsx
        </button>
      </div>

      {/* Resumo (midcard) */}
      <Resumo co={coJson || undefined} fc={fcJson || undefined} />

      {/* Tabela de comparação */}
      <div className="table-container">
        <CompareTable co={coJson || undefined} fc={fcJson || undefined} />
      </div>
    </div>
  );
}

// === Helpers ===

// [IR_CHANGE] CO: envia PDF + profile como query param
async function postCOFileAndGetJson(endpoint: string, file: File, profile: string): Promise<any> {
  const url = new URL(endpoint);
  if (profile) {
    url.searchParams.append("profile", profile);
  }

  const form = new FormData();
  form.append("pdf", file);

  // log útil
  console.log(
    "[HTTP POST CO]", url.toString(),
    Array.from(form.entries()).map(([name, val]) =>
      val instanceof File
        ? { name, kind: "file", fileName: val.name, size: val.size, type: val.type || "application/octet-stream" }
        : { name, kind: "string", value: String(val) }
    )
  );

  const res = await fetch(url.toString(), { method: "POST", body: form });
  const text = await safeText(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` — ${text}` : ""}`);
  try { return JSON.parse(text); } catch { return {}; }
}

// FC: envia PDF em "pdf" + profile (ex.: "fc_marcopolo.py")
async function postFCFileAndGetJson(endpoint: string, file: File, profile: string): Promise<any> {
  const form = new FormData();
  form.append("pdf", file);
  form.append("profile", profile);

  // log útil
  console.log(
    "[HTTP POST FC]", endpoint,
    Array.from(form.entries()).map(([name, val]) =>
      val instanceof File
        ? { name, kind: "file", fileName: val.name, size: val.size, type: val.type || "application/octet-stream" }
        : { name, kind: "string", value: String(val) }
    )
  );

  const res = await fetch(endpoint, { method: "POST", body: form });
  const text = await safeText(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}${text ? ` — ${text}` : ""}`);
  try { return JSON.parse(text); } catch { return {}; }
}

function flattenResponseToRows(resp: any): ItemRow[] {
  // 1) CO: Novo mapeamento para a estrutura resp.data.itens
  const itensCo = resp?.data?.itens;
  if (Array.isArray(itensCo)) {
    return itensCo.map((it: any) => ({
      ordem: it?.ordem ?? "",
      ncm: it?.ncm ?? "",
      descricao: it?.nomeProduto ?? "",
      produto: it?.nomeProduto ?? "",
      qtd: it?.quantidade ?? "",
      unidade: it?.unidade ?? "",
      valor: it?.precoUnit ?? "",
    }));
  }

  // 2) FC: resp.data.itens[k] (Lógica inalterada)
  const itensFc = resp?.data?.itens;
  if (Array.isArray(itensFc)) {
    return itensFc.map((it: any) => ({
      ordem: it?.ordem ?? "",
      ncm: it?.ncm ?? "",
      descricao: it?.descricao ?? "",
      produto: it?.produto ?? "",
      qtd: it?.quantidade ?? it?.qtd ?? "",
      unidade: it?.unidade ?? "",
      valor: it?.valor ?? it?.preco_total ?? "",
    }));
  }

  // 3) Nada reconhecido
  return [];
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
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
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function validatePdf(file: File) {
  if (!file || file.type !== "application/pdf") {
    throw new Error("Envie um arquivo PDF válido.");
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error("PDF muito grande (limite 25 MB).");
  }
}
