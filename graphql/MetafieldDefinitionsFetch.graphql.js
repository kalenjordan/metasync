/**
 * GraphQL query to fetch metafield definitions for a specific owner type
 * Supports filtering by namespace and key
 */
module.exports = `#graphql
query FetchMetafieldDefinitions($ownerType: MetafieldOwnerType!, $namespace: String, $key: String) {
  metafieldDefinitions(first: 100, ownerType: $ownerType, namespace: $namespace, key: $key) {
    nodes {
      id
      namespace
      key
      name
      description
      type { name }
      validations { name value }
      access { admin storefront }
      pinnedPosition
      capabilities {
        smartCollectionCondition { enabled }
        adminFilterable { enabled }
        uniqueValues { enabled }
      }
    }
  }
}
`;
