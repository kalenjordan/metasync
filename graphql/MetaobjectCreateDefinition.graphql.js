/**
 * GraphQL mutation for creating a metaobject definition
 */

const CREATE_METAOBJECT_DEFINITION = `#graphql
mutation createMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
  metaobjectDefinitionCreate(definition: $definition) {
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

module.exports = CREATE_METAOBJECT_DEFINITION;
