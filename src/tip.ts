import {
  SUPPORT_ADDRESSES,
  SUPPORT_LINKS,
  SUPPORT_RECURRING,
  TIP_MESSAGE,
  TIP_PAYMENT,
  TIP_REMEMBER,
  TIP_RESOURCE,
} from "./support";

export type X402Accept = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  asset: string;
  payTo: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema: null;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};

export type TipPayload = {
  x402Version: 1;
  error: string;
  message: string;
  gated: false;
  remember: string;
  settlement: "none";
  facilitator: null;
  note: string;
  accepts: X402Accept[];
  alternatives: {
    kofi: string | null;
    kofi_monthly: string | null;
    btc: string | null;
    eth: string | null;
    sol: string | null;
  };
};

function addressFor(labelPrefix: string): string | null {
  return (
    SUPPORT_ADDRESSES.find((wallet) => wallet.label.startsWith(labelPrefix))
      ?.address ?? null
  );
}

function hrefFor(
  links: readonly { label: string; href: string }[],
  needle: string,
): string | null {
  return links.find((link) => link.label.toLowerCase().includes(needle))?.href ?? null;
}

export function buildTipPayload(): TipPayload {
  return {
    x402Version: 1,
    error: TIP_MESSAGE,
    message: TIP_MESSAGE,
    gated: false,
    remember: TIP_REMEMBER,
    settlement: "none",
    facilitator: null,
    note:
      "This 402 is an invitation, not a gate. Sending payment is optional and does not unlock anything. There is no facilitator and no PAYMENT-RESPONSE to wait for.",
    accepts: [
      {
        scheme: TIP_PAYMENT.scheme,
        network: TIP_PAYMENT.network,
        maxAmountRequired: TIP_PAYMENT.maxAmountRequired,
        asset: TIP_PAYMENT.asset,
        payTo: TIP_PAYMENT.payTo,
        resource: TIP_RESOURCE,
        description:
          "Optional tip for The Allodium. Nothing is unlocked by paying.",
        mimeType: "application/json",
        outputSchema: null,
        maxTimeoutSeconds: 60,
        extra: { ...TIP_PAYMENT.extra },
      },
    ],
    alternatives: {
      kofi: hrefFor(SUPPORT_LINKS, "ko-fi"),
      kofi_monthly: hrefFor(SUPPORT_RECURRING, "ko-fi"),
      btc: addressFor("Bitcoin"),
      eth: addressFor("Ethereum"),
      sol: addressFor("Solana"),
    },
  };
}

export const TIP_JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "public, max-age=3600",
} as const;
