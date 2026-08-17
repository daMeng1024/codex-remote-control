import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { assertSafeProductionBind } from "./config.js";

const interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = {
  eth0: [
    {
      address: "10.123.129.30",
      netmask: "255.255.255.0",
      family: "IPv4",
      mac: "00:00:00:00:00:00",
      internal: false,
      cidr: "10.123.129.30/24",
    },
  ],
};

describe("assertSafeProductionBind", () => {
  it("allows loopback without ZeroTier configuration", () => {
    expect(() =>
      assertSafeProductionBind("127.0.0.1", undefined, {}),
    ).not.toThrow();
  });

  it("allows only the configured locally assigned ZeroTier address", () => {
    expect(() =>
      assertSafeProductionBind("10.123.129.30", "10.123.129.30", interfaces),
    ).not.toThrow();
    expect(() =>
      assertSafeProductionBind("10.123.129.30", "10.123.129.31", interfaces),
    ).toThrow("exactly match");
    expect(() =>
      assertSafeProductionBind("10.123.129.31", "10.123.129.31", interfaces),
    ).toThrow("not assigned");
  });

  it("rejects wildcard and hostname production listeners", () => {
    expect(() =>
      assertSafeProductionBind("0.0.0.0", "0.0.0.0", interfaces),
    ).toThrow("specific");
    expect(() =>
      assertSafeProductionBind("localhost", "localhost", interfaces),
    ).toThrow("specific");
  });
});
