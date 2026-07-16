function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  return typeof value === type;
}

function validateNode(schema, value, path, errors) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((candidate) => {
      const candidateErrors = [];
      validateNode(candidate, value, path, candidateErrors);
      return candidateErrors.length === 0;
    });
    if (!matched) errors.push({ path, code: "any_of", message: "must match one allowed shape" });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    errors.push({ path, code: "const", message: `must equal ${JSON.stringify(schema.const)}` });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push({ path, code: "enum", message: "must be one of the allowed values" });
    return;
  }
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((type) => matchesType(value, type))) {
      errors.push({ path, code: "type", message: `must be ${allowed.join(" or ")}` });
      return;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, code: "min_length", message: `must contain at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, code: "max_length", message: `must contain at most ${schema.maxLength} characters` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push({ path, code: "pattern", message: "has an invalid format" });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, code: "minimum", message: `must be at least ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, code: "maximum", message: `must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, code: "min_items", message: `must contain at least ${schema.minItems} items` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, code: "max_items", message: `must contain at most ${schema.maxItems} items` });
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push({ path, code: "unique_items", message: "must contain unique items" });
    value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push({ path: `${path}.${required}`, code: "required", message: "is required" });
    }
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) errors.push({ path, code: "max_properties", message: `must contain at most ${schema.maxProperties} properties` });
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) errors.push({ path: `${path}.${key}`, code: "additional_property", message: "is not allowed" });
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) validateNode(properties[key], item, `${path}.${key}`, errors);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validateNode(schema.additionalProperties, item, `${path}.${key}`, errors);
    }
  }
}

export function validateToolArguments(schema, value) {
  const errors = [];
  validateNode(schema, value, "$", errors);
  return errors;
}
