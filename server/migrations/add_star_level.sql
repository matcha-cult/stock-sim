-- AlterTable
ALTER TABLE "character_beast" DROP COLUMN "star_level";

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_character_id_item_definition_id_mutation_ty_key" ON "inventory_items"("character_id" ASC, "item_definition_id" ASC, "mutation_type" ASC, "generation" ASC, "quality" ASC, "level" ASC);

-- RenameIndex
ALTER INDEX "inventory_items_character_id_item_definition_id_mutation_ty_idx" RENAME TO "idx_inventory_items_char_def_attrs";

