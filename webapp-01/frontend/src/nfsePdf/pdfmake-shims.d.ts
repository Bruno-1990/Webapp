/* Builds do pdfmake para browser não trazem tipos; declaramos como `any`. */
declare module "pdfmake/build/pdfmake" {
  const pdfMake: unknown;
  export default pdfMake;
}
declare module "pdfmake/build/vfs_fonts" {
  const vfs: unknown;
  export default vfs;
}
declare module "qrcode";
