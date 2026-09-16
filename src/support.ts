/**
 * Tip/support options rendered on /about. Kept as data so adding or
 * removing a method never touches the view. Leave both arrays empty to
 * hide the support section entirely: nothing half-configured ever
 * renders.
 */

export type SupportLink = {
  label: string;
  href: string;
};

export type SupportAddress = {
  /** e.g. "Bitcoin (BTC)" */
  label: string;
  /** The raw address, rendered in a copyable <code> block. */
  address: string;
};

/** Hosted tip pages (Ko-fi and the like). */
export const SUPPORT_LINKS: readonly SupportLink[] = [
  { label: "Ko-fi", href: "https://ko-fi.com/mythorath" },
];

/** Crypto wallet addresses. */
export const SUPPORT_ADDRESSES: readonly SupportAddress[] = [
  {
    label: "Bitcoin (BTC)",
    address: "bc1qwlncslagx4cdacjgmvneqa9swnth5k9erjnsjn",
  },
  {
    label: "Ethereum (ETH)",
    address: "0xeF488Bdc628C0B36Ce6Ccef5A7Ff589b59eDb68C",
  },
  {
    label: "Solana (SOL)",
    address: "5zqjt5TgH9JsQY7CLk8Zrh2M1TZPi9SZBhhTnkLBpbN5",
  },
];

export function hasSupportOptions(): boolean {
  return SUPPORT_LINKS.length > 0 || SUPPORT_ADDRESSES.length > 0;
}
