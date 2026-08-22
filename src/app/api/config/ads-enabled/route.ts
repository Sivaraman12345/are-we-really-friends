import { NextResponse } from "next/server";
import { countShares } from "@/lib/db";
import { SHARE_THRESHOLD_FOR_ADS } from "@/lib/types";

/**
 * GET /api/config/ads-enabled
 *
 * Returns whether ads should be shown, based on the total
 * share count vs the threshold constant.
 */
export async function GET() {
  try {
    const shares = await countShares();
    const enabled = shares >= SHARE_THRESHOLD_FOR_ADS;

    return NextResponse.json({
      ads_enabled: enabled,
      total_shares: shares,
      threshold: SHARE_THRESHOLD_FOR_ADS,
    });
  } catch (error) {
    console.error("Error checking ads config:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
