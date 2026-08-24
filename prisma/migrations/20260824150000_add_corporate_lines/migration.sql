-- CreateEnum
CREATE TYPE "InventoryCorporateLineStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED', 'AVAILABLE');

-- CreateTable
CREATE TABLE "inventory_corporate_lines" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "normalizedNumber" TEXT NOT NULL,
    "carrier" TEXT,
    "plan" TEXT,
    "dataAllowance" TEXT,
    "status" "InventoryCorporateLineStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentHolderId" TEXT,
    "equipmentId" TEXT,
    "simSlot" TEXT,
    "activatedAt" DATE,
    "suspendedAt" DATE,
    "cancelledAt" DATE,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_corporate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_corporate_line_history" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "origin" "InventoryMovementOrigin" NOT NULL DEFAULT 'MANUAL',
    "reason" TEXT,
    "fromHolderId" TEXT,
    "fromHolderName" TEXT,
    "toHolderId" TEXT,
    "toHolderName" TEXT,
    "fromEquipmentId" TEXT,
    "fromEquipmentName" TEXT,
    "toEquipmentId" TEXT,
    "toEquipmentName" TEXT,
    "fromStatus" "InventoryCorporateLineStatus",
    "toStatus" "InventoryCorporateLineStatus",
    "fromSimSlot" TEXT,
    "toSimSlot" TEXT,
    "performedByBitrixUserId" TEXT,
    "performedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_corporate_line_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_corporate_lines_portalId_normalizedNumber_key" ON "inventory_corporate_lines"("portalId", "normalizedNumber");
CREATE INDEX "inventory_corporate_lines_portalId_archivedAt_status_idx" ON "inventory_corporate_lines"("portalId", "archivedAt", "status");
CREATE INDEX "inventory_corporate_lines_portalId_currentHolderId_idx" ON "inventory_corporate_lines"("portalId", "currentHolderId");
CREATE INDEX "inventory_corporate_lines_portalId_equipmentId_idx" ON "inventory_corporate_lines"("portalId", "equipmentId");
CREATE INDEX "inventory_corporate_line_history_portalId_lineId_createdAt_idx" ON "inventory_corporate_line_history"("portalId", "lineId", "createdAt");

-- AddForeignKey
ALTER TABLE "inventory_corporate_lines" ADD CONSTRAINT "inventory_corporate_lines_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_lines" ADD CONSTRAINT "inventory_corporate_lines_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_lines" ADD CONSTRAINT "inventory_corporate_lines_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "inventory_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "inventory_corporate_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_fromHolderId_fkey" FOREIGN KEY ("fromHolderId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_toHolderId_fkey" FOREIGN KEY ("toHolderId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_fromEquipmentId_fkey" FOREIGN KEY ("fromEquipmentId") REFERENCES "inventory_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_corporate_line_history" ADD CONSTRAINT "inventory_corporate_line_history_toEquipmentId_fkey" FOREIGN KEY ("toEquipmentId") REFERENCES "inventory_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
