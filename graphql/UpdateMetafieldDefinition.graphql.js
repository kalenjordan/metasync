/**
 * GraphQL mutation to update a metafield definition
 */
module.exports = `#graphql
mutation UpdateMetafieldDefinition($definition: MetafieldDefinitionUpdateInput!) {
  metafieldDefinitionUpdate(definition: $definition) {
    updatedDefinition { id namespace key }
    userErrors { field message code }
  }
}
`;
