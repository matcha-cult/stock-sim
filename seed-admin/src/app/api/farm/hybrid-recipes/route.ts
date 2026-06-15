import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { farmHybridRecipes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "10");

  const rawItems = db
    .select()
    .from(farmHybridRecipes)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const items = rawItems.map((item) => ({
    ...item,
    requiredCrops: JSON.parse(item.requiredCrops),
  }));

  const total = db.select().from(farmHybridRecipes).all().length;

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const result = db
    .insert(farmHybridRecipes)
    .values({
      ...body,
      requiredCrops: JSON.stringify(body.requiredCrops),
    })
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...data } = body;

  const result = db
    .update(farmHybridRecipes)
    .set({
      ...data,
      requiredCrops: JSON.stringify(data.requiredCrops),
    })
    .where(eq(farmHybridRecipes.id, id))
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = parseInt(searchParams.get("id") || "0");

  db.delete(farmHybridRecipes).where(eq(farmHybridRecipes.id, id)).run();

  return NextResponse.json({ success: true });
}
