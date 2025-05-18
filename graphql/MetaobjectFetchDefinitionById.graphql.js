/**
 * GraphQL query for fetching a metaobject definition by ID
 */

const FETCH_METAOBJECT_DEFINITION_BY_ID = `#graphql
query FetchMetaobjectDefinitionById($id: ID!) {
  metaobjectDefinition(id: $id) {
    id
    type
    name
    description
    fieldDefinitions {
      key
      name
      description
      required
      type {
        name
      }
      validations {
        name
        value
      }
    }
    capabilities {
      publishable {
        enabled
      }
    }
    access {
      admin
      storefront
    }
  }
}
`;

module.exports = FETCH_METAOBJECT_DEFINITION_BY_ID;
