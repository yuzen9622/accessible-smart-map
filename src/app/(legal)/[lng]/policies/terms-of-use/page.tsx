import PolicyDocument from "@/components/legal/PolicyDocument";
import {
  getPolicy,
  getPolicyLocale,
  getPolicyMetadata,
} from "@/content/policy-localization";

type Props = { params: Promise<{ lng: string }> };

export async function generateMetadata({ params }: Props) {
  return getPolicyMetadata(getPolicyLocale((await params).lng), "terms-of-use");
}

export default async function TermsOfUsePage({ params }: Props) {
  const locale = getPolicyLocale((await params).lng);
  return (
    <PolicyDocument
      locale={locale}
      policy={getPolicy(locale, "terms-of-use")}
    />
  );
}
