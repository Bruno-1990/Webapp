import { useEffect } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { CopiarLinkButton } from "../components/CopiarLinkButton.js";
import { getTutorial } from "../tutoriais.js";

export default function TutorialPage() {
  const { slug } = useParams();
  const { hash } = useLocation();
  const tutorial = getTutorial(slug);

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, slug]);

  if (!tutorial) return <Navigate to="/?cat=tutorial" replace />;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <Link
          to="/?cat=tutorial"
          className="text-sm font-medium text-[#347891] hover:underline"
        >
          ← Todos os tutoriais
        </Link>
        <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-[#183844] sm:text-3xl">
          {tutorial.titulo}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#1e3d4d] sm:text-[15px]">
          {tutorial.resumo}
        </p>
        <div className="mt-3">
          <CopiarLinkButton path={`/tutoriais/${tutorial.slug}`} />
        </div>
      </div>

      <ol className="space-y-6">
        {tutorial.passos.map((passo, i) => {
          const id = `passo-${i + 1}`;
          return (
            <li
              key={id}
              id={id}
              className="scroll-mt-24 rounded-2xl border border-[#d4e4eb]/95 bg-white p-4 shadow-[0_8px_24px_-16px_rgb(41_85_104/0.55)] sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#447f98] to-[#629bb5] text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-base font-bold text-[#183844] sm:text-lg">
                    {passo.titulo}
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-[#1e3d4d]">
                    {passo.texto}
                  </p>
                </div>
              </div>
              <img
                src={passo.imagem}
                alt={`Passo ${i + 1}: ${passo.titulo}`}
                loading="lazy"
                className="mx-auto mt-4 max-h-[460px] w-auto max-w-full rounded-xl border border-[#d4e4eb]"
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
