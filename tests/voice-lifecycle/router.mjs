// Framework boundary: this isolated component harness has no Next router.
export const usePathname = () => "/zh-TW";
export const redirect = (url) => {
  throw new Error(`Unexpected redirect: ${url}`);
};
