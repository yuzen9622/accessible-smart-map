export const navigation = {
  params: new URLSearchParams(),
  replacements: [] as string[],
};
const router = { replace: (url: string) => navigation.replacements.push(url) };
export const useSearchParams = () => navigation.params;
export const useRouter = () => router;
export const usePathname = () => "/";
