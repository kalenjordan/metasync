/**
 * GraphQL query to get a metaobject definition's ID by its type
 */
module.exports = `#graphql
query GetMetaobjectDefinitionId($type: String!) {
  metaobjectDefinitionByType(type: $type) {
    id
  }
}
`;
