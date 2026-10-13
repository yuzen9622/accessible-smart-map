import { describe, expect, it } from "vitest";
import { privacyPolicy } from "../policies";
import { privacyPolicyEn } from "../policies.en";

function policyText(policy: typeof privacyPolicy): string {
  return policy.sections
    .flatMap((section) => [
      ...section.paragraphs,
      ...(section.items ?? []),
      ...(section.table?.rows.flat() ?? []),
    ])
    .join("\n");
}

describe("SOS privacy disclosures", () => {
  it("states that resolved SOS links no longer expose location", () => {
    expect(policyText(privacyPolicy)).toContain(
      "SOS 結束後，公開追蹤連結不再提供位置",
    );
    expect(policyText(privacyPolicyEn)).toContain(
      "Once the SOS ends, the public link no longer provides location",
    );
  });

  it("discloses link reset effects and hashed IP plus User-Agent viewer counts", () => {
    const zh = policyText(privacyPolicy);
    expect(zh).toContain("重設分享連結");
    expect(zh).toContain("IP 位址與 User-Agent（UA）組合雜湊");

    const en = policyText(privacyPolicyEn);
    expect(en).toContain("reset its sharing link");
    expect(en).toContain("combined IP address and User-Agent (UA)");
  });
});
