/**
 * GraphQL mutation to delete a metafield definition
 */
module.exports = `#graphql
mutation DeleteMetafieldDefinition($id: ID!) {
  metafieldDefinitionDelete(id: $id) {
    deletedDefinitionId
    userErrors { field message code }
  }
}
`;
