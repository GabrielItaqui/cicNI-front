import { useEffect, useMemo, useRef, useState } from "react";

export type ProfileOption = {
  /** valor enviado ao backend (ex.: "marcopolo" | "foca") */
  value: string;
  /** rótulo visível (ex.: "Marcopolo — Profiles/fc_marcopolo.py") */
  label: string;
  /** caminho completo opcional (p/ tooltip) */
  path?: string;
};

type HeaderProps = {
  coEndpoint: string;
  fcEndpoint: string;
  onChangeCoEndpoint: (v: string) => void;
  onChangeFcEndpoint: (v: string) => void;

  // [IR_CHANGE] onUploadCO e onUploadFC agora recebem o nome do perfil
  onUploadCO: (file: File, profile: string) => void;
  onUploadFC: (file: File, profile: string) => void;

  canDownloadXml: boolean;
  onDownloadXml: () => void;

  coUploaded?: boolean;
  fcUploaded?: boolean;

  /** ID canônico do profile do FC (ex.: "marcopolo", "foca") */
  fcProfile: string;
  // [IR_CHANGE] Nova propriedade para o perfil do CO
  coProfile: string;

  /** lista de perfis (string[] ou objetos). Aceita .py/.json/paths */
  availableProfiles?: ProfileOption[] | string[];

  /** callback recebe o ID canônico (ex.: "marcopolo") */
  onChangeFcProfile: (v: string) => void;
  // [IR_CHANGE] Novo callback para o perfil do CO
  onChangeCoProfile: (v: string) => void;
};

// [IR_CORRECTION]: A função de normalização foi corrigida para manter o prefixo
function canonicalizeProfile(input?: string): string {
  if (!input) return "";
  let s = input.split("/").pop() || input; // `fc_marcopolo.py` ou `CO_ACE72`
  return s.replace(/\.(py|json)$/i, ""); // `fc_marcopolo` ou `CO_ACE72`
}

function prettyLabelFromValue(val: string): string {
  if (!val) return "";
  const s = val.replace(/^(fc_|CO_)/i, ""); // remove o prefixo para formatação
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DEFAULT_PROFILES: ProfileOption[] = [
  { value: "CO_ACE72", label: "CO - ACE-72" },
  { value: "fc_marcopolo", label: "FC - Marcopolo" },
  { value: "fc_foca", label: "FC - Foca" },
];

export default function Header({
  coEndpoint,
  fcEndpoint,
  onChangeCoEndpoint,
  onChangeFcEndpoint,
  onUploadCO,
  onUploadFC,
  canDownloadXml,
  onDownloadXml,
  coUploaded,
  fcUploaded,
  fcProfile,
  coProfile,
  availableProfiles = DEFAULT_PROFILES,
  onChangeFcProfile,
  onChangeCoProfile,
}: HeaderProps) {
  const coInputRef = useRef<HTMLInputElement | null>(null);
  const fcInputRef = useRef<HTMLInputElement | null>(null);

  const [showSettings, setShowSettings] = useState(false);

  // Normaliza availableProfiles -> ProfileOption[] (value já canônico)
  const profileOptions: ProfileOption[] = useMemo(() => {
    if (!Array.isArray(availableProfiles)) {
      return DEFAULT_PROFILES;
    }
    return (availableProfiles as any[]).map((p: any) => {
      if (typeof p === "string") {
        const value = canonicalizeProfile(p);
        const label = prettyLabelFromValue(value);
        return { value, label };
      }
      return p;
    });
  }, [availableProfiles]);

  const coOptions = useMemo(
    () => profileOptions.filter((p) => p.value.startsWith("CO_")),
    [profileOptions]
  );
  const fcOptions = useMemo(
    () => profileOptions.filter((p) => p.value.startsWith("fc_")),
    [profileOptions]
  );

  const currentFCOption =
    fcOptions.find((o) => o.value === fcProfile) || fcOptions[0];
  const currentCOOption =
    coOptions.find((o) => o.value === coProfile) || coOptions[0];

  // Se o pai não passou fcProfile, sobe o padrão no mount/update
  useEffect(() => {
    if (!fcProfile && currentFCOption?.value) {
      onChangeFcProfile(currentFCOption.value);
    }
    if (!coProfile && currentCOOption?.value) {
      onChangeCoProfile(currentCOOption.value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFCOption?.value, currentCOOption?.value]);

  const handleInput =
    (cb: (f: File, p: string) => void, profile: string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) cb(f, profile);
      (e.target as HTMLInputElement).value = "";
    };

  const handleDrop =
    (cb: (f: File, p: string) => void, profile: string) =>
    (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files?.[0];
      if (f) cb(f, profile);
    };

  const prevent = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div style={S.header}>
      {/* [Upload do CO] */}
      <div style={S.leftGroup}>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={coInputRef}
              type="file"
              accept="application/pdf"
              // [IR_CHANGE] Passa o perfil selecionado
              onChange={handleInput(onUploadCO, coProfile)}
              style={{ display: "none" }}
            />
            <button
              style={{ ...S.btn, ...(coUploaded ? S.btnSuccess : {}), minWidth: 160 }}
              title="Enviar PDF do CO (clique ou arraste sobre o botão)"
              onClick={() => coInputRef.current?.click()}
              onDrop={handleDrop(onUploadCO, coProfile)}
              onDragOver={prevent}
            >
              {coUploaded ? "CO enviado ✓" : "Upload do CO"}
            </button>
            {/* [IR_CHANGE] Adiciona a seleção para o perfil do CO */}
            <select
              style={S.select}
              value={coProfile}
              onChange={(e) => onChangeCoProfile(e.target.value)}
            >
              {coOptions.map((p) => (
                <option key={p.value} value={p.value} title={p.path || p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* [Upload da FC] */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8 }}>
            <input
              ref={fcInputRef}
              type="file"
              accept="application/pdf"
              // [IR_CHANGE] Passa o perfil selecionado
              onChange={handleInput(onUploadFC, fcProfile)}
              style={{ display: "none" }}
            />
            <button
              style={{ ...S.btn, ...(fcUploaded ? S.btnSuccess : {}), minWidth: 160 }}
              title="Enviar PDF da FC (clique ou arraste sobre o botão)"
              onClick={() => fcInputRef.current?.click()}
              onDrop={handleDrop(onUploadFC, fcProfile)}
              onDragOver={prevent}
            >
              {fcUploaded ? "FC enviada ✓" : "Upload da FC"}
            </button>
            {/* [IR_CHANGE] Adiciona a seleção para o perfil da FC */}
            <select
              style={S.select}
              value={fcProfile}
              onChange={(e) => onChangeFcProfile(e.target.value)}
            >
              {fcOptions.map((p) => (
                <option key={p.value} value={p.value} title={p.path || p.label}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* [Baixar XML] [Settings] */}
      <div style={S.rightGroup}>
        <button
          style={{ ...S.btn, ...(canDownloadXml ? {} : S.btnDisabled), minWidth: 140 }}
          onClick={onDownloadXml}
          disabled={!canDownloadXml}
          title={canDownloadXml ? "Baixar XML de comparação" : "Envie CO e FC para habilitar"}
        >
          Baixar XML
        </button>

        <div style={{ position: "relative" }}>
          <button
            style={S.btnIcon}
            onClick={() => setShowSettings((v) => !v)}
            title="Configurações"
            aria-label="Configurações"
          >
            ⚙️
          </button>

          {showSettings && (
            <div style={S.popover} role="dialog" aria-label="Configurações">
              <div style={S.popoverRow}>
                <label style={S.label}>Endpoint CO</label>
                <input
                  style={S.input}
                  type="text"
                  value={coEndpoint}
                  onChange={(e) => onChangeCoEndpoint(e.target.value)}
                  placeholder="http://56.125.86.240:8000/v1/co/parse"
                />
              </div>

              <div style={S.popoverRow}>
                <label style={S.label}>Endpoint FC</label>
                <input
                  style={S.input}
                  type="text"
                  value={fcEndpoint}
                  onChange={(e) => onChangeFcEndpoint(e.target.value)}
                  placeholder="http://56.125.86.240:8000/v1/fc/parse"
                />
              </div>

              {/* [IR_CHANGE] Remove o dropdown de dentro do popover e usa a seleção principal */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button style={S.btn} onClick={() => setShowSettings(false)}>
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: 8,
    background: "#fff",
  },
  leftGroup: { display: "flex", alignItems: "center", gap: 8 },
  rightGroup: { display: "flex", alignItems: "center", gap: 8 },
  btn: {
    padding: "8px 12px",
    border: "1px solid #888",
    borderRadius: 6,
    background: "#f7f7f7",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnDisabled: { opacity: 0.6, cursor: "not-allowed" },
  btnSuccess: { background: "#e8f6ee", borderColor: "#34c38f" },
  btnIcon: {
    padding: "8px 10px",
    border: "1px solid #888",
    borderRadius: 6,
    background: "#f7f7f7",
    cursor: "pointer",
    fontSize: 16,
    lineHeight: 1,
  },
  popover: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    width: 520,
    background: "#fff",
    border: "1px solid #ccc",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    padding: 12,
    zIndex: 10,
  },
  popoverRow: {
    display: "grid",
    gridTemplateColumns: "140px 1fr",
    gap: 8,
    alignItems: "center",
    marginBottom: 8,
  },
  label: { fontSize: 12, color: "#444" },
  input: { padding: 8, border: "1px solid #888", borderRadius: 6, width: "100%" },
  select: {
    padding: 8,
    border: "1px solid #888",
    borderRadius: 6,
    width: "100%",
    background: "#fff",
    // centraliza o texto selecionado no select
    textAlignLast: "center" as any,
  },
  profileBadge: {
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 999,
    border: "1px solid #ccc",
    background: "#fafafa",
    color: "#555",
    whiteSpace: "nowrap",
  },
};
