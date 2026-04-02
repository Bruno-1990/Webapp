import { ToolPageTitle, type ToolPageTitleSize } from "./ToolPageTitle.js";

type Props = {
  size?: ToolPageTitleSize;
};

export function TitleNfeXmlXlsx({ size = "home" }: Props) {
  return <ToolPageTitle left="NFe XML" right="XLSX" size={size} />;
}
