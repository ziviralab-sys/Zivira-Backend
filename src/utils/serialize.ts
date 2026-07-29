export function serializeDocument<T extends { _id: unknown; createdAt?: Date; updatedAt?: Date }>(doc: T) {
  const object = "toObject" in doc && typeof doc.toObject === "function" ? doc.toObject() : doc;
  const { _id, __v, ...rest } = object as Record<string, unknown>;

  return {
    id: String(_id),
    ...rest,
    createdAt: rest.createdAt instanceof Date ? rest.createdAt.toISOString() : rest.createdAt,
    updatedAt: rest.updatedAt instanceof Date ? rest.updatedAt.toISOString() : rest.updatedAt
  };
}
