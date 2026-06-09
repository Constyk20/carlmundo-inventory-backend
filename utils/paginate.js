/**
 * Applies pagination and sorting to a Mongoose query.
 * Returns paginated data + metadata.
 */
const paginate = async (model, filter = {}, options = {}, populate = null) => {
  const {
    page = 1,
    limit = 20,
    sort = '-createdAt',
    select = '',
  } = options;

  const skip = (page - 1) * limit;

  let query = model.find(filter).sort(sort).skip(skip).limit(limit);
  if (select) query = query.select(select);
  if (populate) {
    if (Array.isArray(populate)) {
      populate.forEach((p) => { query = query.populate(p); });
    } else {
      query = query.populate(populate);
    }
  }

  const [data, total] = await Promise.all([query, model.countDocuments(filter)]);

  return {
    data,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
};

module.exports = { paginate };
