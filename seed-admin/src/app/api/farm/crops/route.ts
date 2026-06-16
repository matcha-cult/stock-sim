import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { farmCrops } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "30");
  const search = searchParams.get("search") || "";

  let query = db.select().from(farmCrops);

  if (search) {
    query = query.where(
      eq(farmCrops.name, search)
    ) as typeof query;
  }

  const rawItems = query.limit(pageSize).offset((page - 1) * pageSize).all();
  const total = db.select().from(farmCrops).all().length;

  const items = rawItems.map((item) => ({
    ...item,
    element: item.element ? JSON.parse(item.element) : null,
    growthStageMinutes: JSON.parse(item.growthStageMinutes),
    stageLabels: JSON.parse(item.stageLabels),
  }));

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
    .insert(farmCrops)
    .values({
      ...body,
      element: JSON.stringify(body.element),
      growthStageMinutes: JSON.stringify(body.growthStageMinutes),
      stageLabels: JSON.stringify(body.stageLabels),
    })
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...data } = body;

  const result = db
    .update(farmCrops)
    .set({
      ...data,
      element: JSON.stringify(data.element),
      growthStageMinutes: JSON.stringify(data.growthStageMinutes),
      stageLabels: JSON.stringify(data.stageLabels),
    })
    .where(eq(farmCrops.id, id))
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = parseInt(searchParams.get("id") || "0");

  db.delete(farmCrops).where(eq(farmCrops.id, id)).run();

  return NextResponse.json({ success: true });
}
