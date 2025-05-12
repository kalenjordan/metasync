/**
 * GraphQL query to get the type of a metaobject definition by its ID
 */
module.exports = `#graphql
query GetMetaobjectDefinitionType($id: ID!) {
  metaobjectDefinition(id: $id) {
    type
  }
}
`;
