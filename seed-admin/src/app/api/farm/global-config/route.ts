import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { farmGlobalConfig } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const config = db.select().from(farmGlobalConfig).where(eq(farmGlobalConfig.id, 1)).get();

  if (!config) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    ...config,
    expansions: JSON.parse(config.expansions),
    farmTiers: JSON.parse(config.farmTiers),
    initialSeeds: JSON.parse(config.initialSeeds),
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();

  const result = db
    .update(farmGlobalConfig)
    .set({
      ...body,
      expansions: JSON.stringify(body.expansions),
      farmTiers: JSON.stringify(body.farmTiers),
      initialSeeds: JSON.stringify(body.initialSeeds),
    })
    .where(eq(farmGlobalConfig.id, 1))
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const result = db
    .insert(farmGlobalConfig)
    .values({
      id: 1,
      ...body,
      expansions: JSON.stringify(body.expansions),
      farmTiers: JSON.stringify(body.farmTiers),
      initialSeeds: JSON.stringify(body.initialSeeds),
    })
    .returning()
    .get();

  return NextResponse.json(result);
}
