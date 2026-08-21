-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "JobExecutionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "BitrixPortalStatus" AS ENUM ('PENDING', 'ACTIVE', 'TOKEN_INVALID', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "BitrixSyncStatus" AS ENUM ('NEVER_RUN', 'PENDING', 'RUNNING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "InventoryRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "InventoryEquipmentStatus" AS ENUM ('ACTIVE', 'STOCK', 'MAINTENANCE', 'BROKEN', 'LOANED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "InventoryPersonStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "InventoryEmploymentType" AS ENUM ('CLT', 'PJ', 'INTERN', 'TEMPORARY', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryFieldType" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN', 'PASSWORD', 'MAC', 'IP');

-- CreateEnum
CREATE TYPE "InventoryMatchStatus" AS ENUM ('UNREVIEWED', 'MATCHED', 'AMBIGUOUS', 'UNMATCHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryMovementOrigin" AS ENUM ('MANUAL', 'IMPORT', 'INITIAL_REGISTRATION', 'BULK_TRANSFER');

-- CreateEnum
CREATE TYPE "InventoryTermType" AS ENUM ('DELIVERY', 'RESPONSIBILITY', 'RETURN', 'TRANSFER');

-- CreateEnum
CREATE TYPE "InventoryAttachmentEntityType" AS ENUM ('EQUIPMENT', 'PERSON', 'TERM', 'CUSTOM_RECORD');

-- CreateEnum
CREATE TYPE "InventoryImportStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "job_executions" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "JobExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitrix_portals" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "status" "BitrixPortalStatus" NOT NULL DEFAULT 'PENDING',
    "installedByBitrixUserId" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL,
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "syncStatus" "BitrixSyncStatus" NOT NULL DEFAULT 'NEVER_RUN',
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncErrorAt" TIMESTAMP(3),
    "lastSyncErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitrix_portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitrix_users" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "position" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "departmentIds" TEXT[],
    "managerBitrixUserId" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenSyncId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitrix_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitrix_departments" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "bitrixDepartmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentBitrixDepartmentId" TEXT,
    "headBitrixUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenSyncId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bitrix_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitrix_handshakes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "context" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bitrix_handshakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_role_assignments" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "bitrixUserId" TEXT NOT NULL,
    "role" "InventoryRole" NOT NULL,
    "createdByBitrixUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_categories" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "prefix" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'box-seam',
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_fields" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "InventoryFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "listVisible" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_departments" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "bitrixDepartmentId" TEXT,
    "bitrixMatchStatus" "InventoryMatchStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "bitrixMatchMethod" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_people" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "title" TEXT,
    "email" TEXT,
    "employeeNumber" TEXT,
    "employmentType" "InventoryEmploymentType",
    "status" "InventoryPersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "bitrixUserId" TEXT,
    "bitrixMatchStatus" "InventoryMatchStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "bitrixMatchMethod" TEXT,
    "archivedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_equipment" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "patrimony" TEXT,
    "assetTag" TEXT,
    "name" TEXT,
    "categoryId" TEXT NOT NULL,
    "status" "InventoryEquipmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentHolderId" TEXT,
    "departmentId" TEXT,
    "locationId" TEXT,
    "locationDetail" TEXT,
    "serialNumber" TEXT,
    "invoiceNumber" TEXT,
    "acquiredAt" DATE,
    "receivedAt" DATE,
    "deliveredAt" DATE,
    "warrantyEndsAt" DATE,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "legacyInvalidSpecs" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "equipmentId" TEXT NOT NULL,
    "fromPersonId" TEXT,
    "toPersonId" TEXT,
    "fromPersonName" TEXT,
    "toPersonName" TEXT,
    "fromDepartmentId" TEXT,
    "toDepartmentId" TEXT,
    "fromDepartmentName" TEXT,
    "toDepartmentName" TEXT,
    "movedAt" DATE NOT NULL,
    "reason" TEXT,
    "origin" "InventoryMovementOrigin" NOT NULL DEFAULT 'MANUAL',
    "performedByBitrixUserId" TEXT,
    "performedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_extensions" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "number" TEXT,
    "collaborator" TEXT,
    "department" TEXT,
    "type" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_receivings" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "receivedAt" DATE,
    "equipment" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "tag" TEXT,
    "deliveredAt" DATE,
    "deliveredTo" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_receivings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_custom_modules" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'clipboard',
    "description" TEXT,
    "titleLabel" TEXT NOT NULL DEFAULT 'Nome',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_custom_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_custom_module_fields" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "InventoryFieldType" NOT NULL DEFAULT 'TEXT',
    "options" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "listVisible" BOOLEAN NOT NULL DEFAULT false,
    "expiryAlert" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_custom_module_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_custom_records" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "title" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_custom_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_terms" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "type" "InventoryTermType" NOT NULL DEFAULT 'RESPONSIBILITY',
    "personId" TEXT,
    "personName" TEXT,
    "personDepartmentName" TEXT,
    "destinationPersonId" TEXT,
    "destinationPersonName" TEXT,
    "destinationDepartmentName" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "observations" TEXT,
    "createdByBitrixUserId" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "inventory_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_attachments" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "legacySource" TEXT,
    "legacyId" INTEGER,
    "entityType" "InventoryAttachmentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT,
    "size" INTEGER NOT NULL,
    "description" TEXT,
    "uploadedByBitrixUserId" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_blob_cleanups" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "blobUrl" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_blob_cleanups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_import_runs" (
    "id" TEXT NOT NULL,
    "portalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "formatVersion" INTEGER NOT NULL,
    "rawSha256" TEXT NOT NULL,
    "canonicalSha256" TEXT,
    "status" "InventoryImportStatus" NOT NULL DEFAULT 'RUNNING',
    "expectedCounts" JSONB NOT NULL DEFAULT '{}',
    "report" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "executedBy" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_executions_idempotencyKey_key" ON "job_executions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "job_executions_jobType_status_idx" ON "job_executions"("jobType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bitrix_portals_domain_key" ON "bitrix_portals"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "bitrix_portals_memberId_key" ON "bitrix_portals"("memberId");

-- CreateIndex
CREATE INDEX "bitrix_users_portalId_active_idx" ON "bitrix_users"("portalId", "active");

-- CreateIndex
CREATE INDEX "bitrix_users_portalId_lastSyncedAt_idx" ON "bitrix_users"("portalId", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bitrix_users_portalId_bitrixUserId_key" ON "bitrix_users"("portalId", "bitrixUserId");

-- CreateIndex
CREATE INDEX "bitrix_departments_portalId_active_idx" ON "bitrix_departments"("portalId", "active");

-- CreateIndex
CREATE INDEX "bitrix_departments_portalId_lastSyncedAt_idx" ON "bitrix_departments"("portalId", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bitrix_departments_portalId_bitrixDepartmentId_key" ON "bitrix_departments"("portalId", "bitrixDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "bitrix_handshakes_codeHash_key" ON "bitrix_handshakes"("codeHash");

-- CreateIndex
CREATE INDEX "bitrix_handshakes_expiresAt_idx" ON "bitrix_handshakes"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_portalId_entityType_entityId_idx" ON "audit_logs"("portalId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_portalId_createdAt_idx" ON "audit_logs"("portalId", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_role_assignments_portalId_role_idx" ON "inventory_role_assignments"("portalId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_role_assignments_portalId_bitrixUserId_key" ON "inventory_role_assignments"("portalId", "bitrixUserId");

-- CreateIndex
CREATE INDEX "inventory_categories_portalId_active_sortOrder_idx" ON "inventory_categories"("portalId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_portalId_name_key" ON "inventory_categories"("portalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_categories_portalId_legacySource_legacyId_key" ON "inventory_categories"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_fields_portalId_categoryId_active_sortOrder_idx" ON "inventory_fields"("portalId", "categoryId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_fields_categoryId_key_key" ON "inventory_fields"("categoryId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_fields_portalId_legacySource_legacyId_key" ON "inventory_fields"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_departments_portalId_active_name_idx" ON "inventory_departments"("portalId", "active", "name");

-- CreateIndex
CREATE INDEX "inventory_departments_portalId_bitrixDepartmentId_idx" ON "inventory_departments"("portalId", "bitrixDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_departments_portalId_name_key" ON "inventory_departments"("portalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_departments_portalId_legacySource_legacyId_key" ON "inventory_departments"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_locations_portalId_active_name_idx" ON "inventory_locations"("portalId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_portalId_name_key" ON "inventory_locations"("portalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_portalId_legacySource_legacyId_key" ON "inventory_locations"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_people_portalId_status_name_idx" ON "inventory_people"("portalId", "status", "name");

-- CreateIndex
CREATE INDEX "inventory_people_portalId_departmentId_idx" ON "inventory_people"("portalId", "departmentId");

-- CreateIndex
CREATE INDEX "inventory_people_portalId_bitrixUserId_idx" ON "inventory_people"("portalId", "bitrixUserId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_people_portalId_legacySource_legacyId_key" ON "inventory_people"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_people_portalId_bitrixUserId_key" ON "inventory_people"("portalId", "bitrixUserId");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_archivedAt_status_idx" ON "inventory_equipment"("portalId", "archivedAt", "status");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_categoryId_status_idx" ON "inventory_equipment"("portalId", "categoryId", "status");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_currentHolderId_idx" ON "inventory_equipment"("portalId", "currentHolderId");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_departmentId_idx" ON "inventory_equipment"("portalId", "departmentId");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_locationId_idx" ON "inventory_equipment"("portalId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_assetTag_idx" ON "inventory_equipment"("portalId", "assetTag");

-- CreateIndex
CREATE INDEX "inventory_equipment_portalId_serialNumber_idx" ON "inventory_equipment"("portalId", "serialNumber");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_equipment_portalId_patrimony_key" ON "inventory_equipment"("portalId", "patrimony");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_equipment_portalId_legacySource_legacyId_key" ON "inventory_equipment"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_movements_portalId_equipmentId_movedAt_idx" ON "inventory_movements"("portalId", "equipmentId", "movedAt");

-- CreateIndex
CREATE INDEX "inventory_movements_portalId_fromPersonId_movedAt_idx" ON "inventory_movements"("portalId", "fromPersonId", "movedAt");

-- CreateIndex
CREATE INDEX "inventory_movements_portalId_toPersonId_movedAt_idx" ON "inventory_movements"("portalId", "toPersonId", "movedAt");

-- CreateIndex
CREATE INDEX "inventory_movements_portalId_createdAt_idx" ON "inventory_movements"("portalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_portalId_legacySource_legacyId_key" ON "inventory_movements"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_extensions_portalId_archivedAt_active_number_idx" ON "inventory_extensions"("portalId", "archivedAt", "active", "number");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_extensions_portalId_legacySource_legacyId_key" ON "inventory_extensions"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_receivings_portalId_archivedAt_receivedAt_idx" ON "inventory_receivings"("portalId", "archivedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_receivings_portalId_legacySource_legacyId_key" ON "inventory_receivings"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_custom_modules_portalId_active_sortOrder_idx" ON "inventory_custom_modules"("portalId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_custom_modules_portalId_name_key" ON "inventory_custom_modules"("portalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_custom_modules_portalId_legacySource_legacyId_key" ON "inventory_custom_modules"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_custom_module_fields_portalId_moduleId_active_sor_idx" ON "inventory_custom_module_fields"("portalId", "moduleId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_custom_module_fields_moduleId_key_key" ON "inventory_custom_module_fields"("moduleId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_custom_module_fields_portalId_legacySource_legacy_key" ON "inventory_custom_module_fields"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_custom_records_portalId_moduleId_archivedAt_idx" ON "inventory_custom_records"("portalId", "moduleId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_custom_records_portalId_legacySource_legacyId_key" ON "inventory_custom_records"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_terms_portalId_archivedAt_createdAt_idx" ON "inventory_terms"("portalId", "archivedAt", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_terms_portalId_personId_createdAt_idx" ON "inventory_terms"("portalId", "personId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_terms_portalId_legacySource_legacyId_key" ON "inventory_terms"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "inventory_attachments_portalId_entityType_entityId_createdA_idx" ON "inventory_attachments"("portalId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_attachments_portalId_legacySource_legacyId_key" ON "inventory_attachments"("portalId", "legacySource", "legacyId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_blob_cleanups_blobUrl_key" ON "inventory_blob_cleanups"("blobUrl");

-- CreateIndex
CREATE INDEX "inventory_blob_cleanups_portalId_completedAt_createdAt_idx" ON "inventory_blob_cleanups"("portalId", "completedAt", "createdAt");

-- CreateIndex
CREATE INDEX "inventory_import_runs_portalId_status_startedAt_idx" ON "inventory_import_runs"("portalId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_import_runs_portalId_source_rawSha256_key" ON "inventory_import_runs"("portalId", "source", "rawSha256");

-- AddForeignKey
ALTER TABLE "bitrix_users" ADD CONSTRAINT "bitrix_users_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitrix_departments" ADD CONSTRAINT "bitrix_departments_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitrix_handshakes" ADD CONSTRAINT "bitrix_handshakes_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_role_assignments" ADD CONSTRAINT "inventory_role_assignments_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_fields" ADD CONSTRAINT "inventory_fields_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_fields" ADD CONSTRAINT "inventory_fields_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "inventory_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_departments" ADD CONSTRAINT "inventory_departments_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_people" ADD CONSTRAINT "inventory_people_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_people" ADD CONSTRAINT "inventory_people_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_equipment" ADD CONSTRAINT "inventory_equipment_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_equipment" ADD CONSTRAINT "inventory_equipment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "inventory_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_equipment" ADD CONSTRAINT "inventory_equipment_currentHolderId_fkey" FOREIGN KEY ("currentHolderId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_equipment" ADD CONSTRAINT "inventory_equipment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "inventory_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_equipment" ADD CONSTRAINT "inventory_equipment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "inventory_equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "inventory_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "inventory_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_extensions" ADD CONSTRAINT "inventory_extensions_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_receivings" ADD CONSTRAINT "inventory_receivings_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_custom_modules" ADD CONSTRAINT "inventory_custom_modules_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_custom_module_fields" ADD CONSTRAINT "inventory_custom_module_fields_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_custom_module_fields" ADD CONSTRAINT "inventory_custom_module_fields_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "inventory_custom_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_custom_records" ADD CONSTRAINT "inventory_custom_records_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_custom_records" ADD CONSTRAINT "inventory_custom_records_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "inventory_custom_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_terms" ADD CONSTRAINT "inventory_terms_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_terms" ADD CONSTRAINT "inventory_terms_personId_fkey" FOREIGN KEY ("personId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_terms" ADD CONSTRAINT "inventory_terms_destinationPersonId_fkey" FOREIGN KEY ("destinationPersonId") REFERENCES "inventory_people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_attachments" ADD CONSTRAINT "inventory_attachments_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_blob_cleanups" ADD CONSTRAINT "inventory_blob_cleanups_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_import_runs" ADD CONSTRAINT "inventory_import_runs_portalId_fkey" FOREIGN KEY ("portalId") REFERENCES "bitrix_portals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

