import { Check, Link2 } from "lucide-react";
import { useState } from "react";

function copiar(texto: string): Promise<boolean> {
  /** navigator.clipboard exige contexto seguro; na LAN (http) cai no execCommand. */
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(texto).then(
      () => true,
      () => false,
    );
  }
  const ta = document.createElement("textarea");
  ta.value = texto;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return Promise.resolve(ok);
}

export function CopiarLinkButton({ path }: { path: string }) {
  const [copiado, setCopiado] = useState(false);

  const onClick = async () => {
    if (await copiar(`${window.location.origin}${path}`)) {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-[#c5dfe8] bg-[#f2fafd] px-2.5 py-1 text-[12px] font-semibold text-[#2d6a82] transition hover:border-[#9ec8d8] hover:bg-[#e8f5fa]"
    >
      {copiado ? (
        <>
          <Check className="h-3.5 w-3.5" /> Link copiado
        </>
      ) : (
        <>
          <Link2 className="h-3.5 w-3.5" /> Copiar link
        </>
      )}
    </button>
  );
}
