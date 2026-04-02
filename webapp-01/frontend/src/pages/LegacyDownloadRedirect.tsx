import { Navigate, useParams } from "react-router-dom";

/** Compatibilidade com links antigos `/download/:jobId`. */
export default function LegacyDownloadRedirect() {
  const { jobId } = useParams<{ jobId: string }>();
  const id = jobId ? decodeURIComponent(jobId) : "";
  if (!id) return <Navigate to="/" replace />;
  return <Navigate to={`/tools/nfe/download/${encodeURIComponent(id)}`} replace />;
}
