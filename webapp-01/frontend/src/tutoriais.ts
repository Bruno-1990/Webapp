export type TutorialPasso = {
  titulo: string;
  texto: string;
  imagem: string;
};

export type Tutorial = {
  slug: string;
  titulo: string;
  resumo: string;
  passos: TutorialPasso[];
};

const BASE = "/tutoriais/atalho-servidor";

export const TUTORIAIS: Tutorial[] = [
  {
    slug: "atalho-servidor",
    titulo: "Como Acessar Documentos Específicos no Serv01",
    resumo:
      "Crie na área de trabalho o atalho Serv01 e acesse as pastas de rede da empresa, como Documentos Específicos, com seu usuário.",
    passos: [
      {
        titulo: "Crie um novo atalho",
        texto:
          "Na área de trabalho, clique com o botão direito em um espaço vazio, vá em Novo e escolha Atalho.",
        imagem: `${BASE}/passo-1.png`,
      },
      {
        titulo: "Informe o endereço do servidor",
        texto:
          "No campo “Digite o local do item”, escreva \\\\192.168.0.1 e clique em Avançar.",
        imagem: `${BASE}/passo-2.png`,
      },
      {
        titulo: "Dê um nome ao atalho",
        texto: "Digite um nome, por exemplo Serv01, e clique em Concluir.",
        imagem: `${BASE}/passo-3.png`,
      },
      {
        titulo: "Abra o atalho",
        texto: "O atalho aparece na área de trabalho. Dê dois cliques para abrir.",
        imagem: `${BASE}/passo-4.png`,
      },
      {
        titulo: "Se pedir credenciais, abra “Mais opções”",
        texto:
          "Se o Windows exibir “Suas credenciais não funcionaram”, clique em Mais opções.",
        imagem: `${BASE}/passo-5.png`,
      },
      {
        titulo: "Use uma conta diferente",
        texto: "Selecione Usar uma conta diferente.",
        imagem: `${BASE}/passo-6.png`,
      },
      {
        titulo: "Entre com seu usuário e senha",
        texto:
          "Em Nome de usuário, escreva central\\ seguido do seu usuário (exemplo: central\\nome-do-usuário), informe sua senha e clique em OK.",
        imagem: `${BASE}/passo-7.png`,
      },
      {
        titulo: "Pronto: as pastas da rede abrem",
        texto:
          "As pastas do servidor aparecem e você já pode acessá-las. Nas próximas vezes basta abrir o atalho.",
        imagem: `${BASE}/passo-8.png`,
      },
    ],
  },
];

export function getTutorial(slug: string | undefined): Tutorial | undefined {
  return TUTORIAIS.find((t) => t.slug === slug);
}
