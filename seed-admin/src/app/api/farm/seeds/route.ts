import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { farmSeeds } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const pageSize = parseInt(searchParams.get("pageSize") || "30");

  const items = db
    .select()
    .from(farmSeeds)
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  const total = db.select().from(farmSeeds).all().length;

  return NextResponse.json({
    items,
    total,
    page,
    pageSize,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const result = db.insert(farmSeeds).values(body).returning().get();

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...data } = body;

  const result = db
    .update(farmSeeds)
    .set(data)
    .where(eq(farmSeeds.id, id))
    .returning()
    .get();

  return NextResponse.json(result);
}

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = parseInt(searchParams.get("id") || "0");

  db.delete(farmSeeds).where(eq(farmSeeds.id, id)).run();

  return NextResponse.json({ success: true });
}
