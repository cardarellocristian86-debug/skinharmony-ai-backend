const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const reportsDir = path.join(repoRoot, "reports", "ai-gold-tests", "privilege-config");
const { DesktopMirrorService } = require("../src/DesktopMirrorService");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((header) => escapeCsv(row[header] ?? "")).join(","));
  });
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  ensureDir(reportsDir);
  const service = new DesktopMirrorService();
  const session = { role: "superadmin", username: "cristian", centerId: "center_admin" };
  const services = service.filterByCenter(service.servicesRepository.list(), session);
  const staff = service.filterByCenter(service.staffRepository.list(), session);

  const serviceRows = services.map((item) => ({
    service_id: item.id || "",
    service_name: item.name || "",
    category: item.category || item.serviceCategory || "",
    price_cents: item.priceCents || item.price || "",
    duration_min: item.durationMin || item.duration || "",
    estimated_product_cost_cents: item.estimatedProductCostCents || item.productCostCents || "",
    technology_cost_cents: item.technologyCostCents || "",
    product_links_count: Array.isArray(item.productLinks) ? item.productLinks.length : 0,
    technology_links_count: Array.isArray(item.technologyLinks) ? item.technologyLinks.length : 0
  }));

  const staffRows = staff.map((item) => ({
    operator_id: item.id || "",
    operator_name: item.name || "",
    role: item.role || "",
    hourly_cost_cents: item.hourlyCostCents || item.hourlyCost || "",
    service_ids: Array.isArray(item.serviceIds) ? item.serviceIds.join("|") : Array.isArray(item.assignedServiceIds) ? item.assignedServiceIds.join("|") : ""
  }));

  const serviceFile = path.join(reportsDir, "privilege_service_cost_template.csv");
  const staffFile = path.join(reportsDir, "privilege_operator_cost_template.csv");

  writeCsv(serviceFile, [
    "service_id",
    "service_name",
    "category",
    "price_cents",
    "duration_min",
    "estimated_product_cost_cents",
    "technology_cost_cents",
    "product_links_count",
    "technology_links_count"
  ], serviceRows);

  writeCsv(staffFile, [
    "operator_id",
    "operator_name",
    "role",
    "hourly_cost_cents",
    "service_ids"
  ], staffRows);

  const summary = {
    generatedAt: new Date().toISOString(),
    centerId: "center_admin",
    services: serviceRows.length,
    staff: staffRows.length,
    serviceFile,
    staffFile
  };
  fs.writeFileSync(path.join(reportsDir, "privilege_configuration_templates_summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main();
