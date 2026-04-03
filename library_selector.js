const library = require("./library_beta_v1.json");

function mapIssueToLibrary(issue) {
  const map = {
    cellulite: "cellulite",
    lassita: "lassita_tono",
    texture: "texture_superficie",
    idratazione: "disidratazione",
    disidratazione: "disidratazione",
    sebo_scalp: "sebo_o_cute",
    cute_scalp: "sebo_o_cute",
    sebo_o_cute: "sebo_o_cute"
  };
  return map[issue] || issue;
}

function areaMatches(entryArea, selectedArea) {
  if (entryArea === selectedArea) {
    return true;
  }

  if (entryArea === "viso_corpo" && (selectedArea === "viso" || selectedArea === "corpo")) {
    return true;
  }

  return false;
}

function pickRecommendedPackage(entry, payload) {
  if (!entry?.packages?.length) {
    return null;
  }

  if (entry.target.issue === "cellulite" && entry.packages[1] && payload.technologies.length >= 2) {
    return entry.packages[1];
  }

  if (payload.ageRange === "46-55" || payload.ageRange === "56+") {
    return entry.packages[entry.packages.length - 1];
  }

  return entry.packages[0];
}

function selectLibraryProtocol(payload) {
  const targetIssue = mapIssueToLibrary(payload.issue);
  const candidates = library.protocols.filter((entry) => {
    return areaMatches(entry.target.area, payload.area) && entry.target.issue === targetIssue;
  });

  if (!candidates.length) {
    return null;
  }

  const scored = candidates
    .map((entry) => ({
      entry,
      techScore: entry.target.suitable_tech.filter((tech) => payload.technologies.includes(tech)).length
    }))
    .sort((a, b) => b.techScore - a.techScore);

  return scored[0].techScore > 0 ? scored[0].entry : null;
}

module.exports = {
  library,
  mapIssueToLibrary,
  areaMatches,
  pickRecommendedPackage,
  selectLibraryProtocol
};
