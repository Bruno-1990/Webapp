
export function lname(tag: string): string {
  if (tag.includes("}")) return tag.split("}", 2)[1] ?? tag;
  const i = tag.lastIndexOf(":");
  return i >= 0 ? tag.slice(i + 1) : tag;
}

export function elementLocalName(el: Element): string {
  const le = el as Element & { localName?: string };
  if (le.localName) return le.localName;
  return lname(el.tagName ?? "");
}

export function text(el: Element | null | undefined): string {
  if (!el) return "";
  const t = el.textContent ?? "";
  return t.trim();
}

export function digits(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export function childrenElements(parent: Element): Element[] {
  const out: Element[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1) out.push(c as Element);
  }
  return out;
}

export function findFirstLocal(
  parent: Element | null | undefined,
  pathLocal: string
): Element | null {
  if (!parent) return null;
  const parts = pathLocal.split("/").map((p) => p.trim()).filter(Boolean);
  let nodes: Element[] = [parent];
  for (const name of parts) {
    const next: Element[] = [];
    for (const n of nodes) {
      for (const ch of childrenElements(n)) {
        if (elementLocalName(ch) === name) next.push(ch);
      }
    }
    if (next.length === 0) return null;
    nodes = next;
  }
  return nodes[0] ?? null;
}

export function findAllLocal(parent: Element | null | undefined, nameLocal: string): Element[] {
  if (!parent) return [];
  const target = nameLocal.trim();
  const out: Element[] = [];
  const stack: Element[] = [parent];
  while (stack.length) {
    const node = stack.pop()!;
    for (const ch of childrenElements(node)) {
      if (elementLocalName(ch) === target) out.push(ch);
      stack.push(ch);
    }
  }
  return out;
}

/** Primeiro filho elemento (ex.: ICMS00 dentro de ICMS); se vazio, retorna o próprio nó. */
export function firstGrandchildElement(parent: Element | null): Element | null {
  if (!parent) return null;
  const kids = childrenElements(parent);
  if (kids.length === 0) return parent;
  return kids[0] ?? null;
}
