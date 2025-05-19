/**
 * GraphQL mutation for updating a metaobject definition
 */

const UPDATE_METAOBJECT_DEFINITION = `#graphql
mutation updateMetaobjectDefinition($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
  metaobjectDefinitionUpdate(id: $id, definition: $definition) {
    metaobjectDefinition {
      id
      type
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

module.exports = UPDATE_METAOBJECT_DEFINITION;
