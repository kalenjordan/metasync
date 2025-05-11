/**
 * Sync Result Tracker
 *
 * Handles tracking and aggregating results from sync operations.
 * Provides methods to track success/failure counts and generate summary reports.
 */
const logger = require('./logger');

class SyncResultTracker {
  constructor() {
    this.results = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      deleted: 0,
      metafields: {
        processed: 0,
        transformed: 0,
        blanked: 0,
        errors: 0,
        warnings: 0,
        unsupportedTypes: []
      }
    };
  }

  /**
   * Track a successful product creation
   * @param {Object} createResult - The result object from product creation
   */
  trackCreation(createResult) {
    this.results.created++;
    this.mergeMetafieldStats(createResult);
    return this;
  }

  /**
   * Track a successful product update
   * @param {Object} updateResult - The result object from product update
   */
  trackUpdate(updateResult) {
    this.results.updated++;
    this.mergeMetafieldStats(updateResult);
    return this;
  }

  /**
   * Track a successful product deletion
   */
  trackDeletion() {
    this.results.deleted++;
    return this;
  }

  /**
   * Track a failed operation
   */
  trackFailure() {
    this.results.failed++;
    return this;
  }

  /**
   * Track a skipped operation
   */
  trackSkipped() {
    this.results.skipped++;
    return this;
  }

  /**
   * Merge metafield stats from an operation result
   * @param {Object} result - The operation result containing metafield stats
   */
  mergeMetafieldStats(result) {
    if (!result || !result.results || !result.results.metafields) {
      return;
    }

    const stats = result.results.metafields;

    this.results.metafields.processed += stats.processed || 0;
    this.results.metafields.transformed += stats.transformed || 0;
    this.results.metafields.blanked += stats.blanked || 0;
    this.results.metafields.errors += stats.errors || 0;
    this.results.metafields.warnings += stats.warnings || 0;

    // Merge unsupported types arrays, avoiding duplicates
    if (stats.unsupportedTypes && stats.unsupportedTypes.length > 0) {
      stats.unsupportedTypes.forEach(type => {
        if (!this.results.metafields.unsupportedTypes.includes(type)) {
          this.results.metafields.unsupportedTypes.push(type);
        }
      });
    }
  }

  /**
   * Get current results
   * @returns {Object} - Current result counts
   */
  getResults() {
    return this.results;
  }

  /**
   * Log a summary of results
   */
  logSummary() {
    console.log(''); // Add a newline before summary
    logger.success(
      `Finished syncing products. Results: ${this.results.created} created, ${this.results.updated} updated, ` +
      `${this.results.deleted} force deleted, ${this.results.failed} failed`,
      0
    );

    // Add metafield stats to the summary if any were processed
    if (this.results.metafields.processed > 0) {
      logger.info(
        `Metafield stats: ${this.results.metafields.processed} processed, ` +
        `${this.results.metafields.transformed} transformed, ` +
        `${this.results.metafields.blanked} blanked due to errors, ` +
        `${this.results.metafields.warnings} warnings`,
        0
      );
    }
  }

  /**
   * Get a formatted result object suitable for returning from strategy
   * @returns {Object} - Formatted result object
   */
  formatForStrategyResult() {
    return {
      // For products, we should report them as data results, not definition results
      definitionResults: null,
      dataResults: this.results,
      metafieldResults: {
        processed: this.results.metafields.processed,
        transformed: this.results.metafields.transformed,
        blanked: this.results.metafields.blanked,
        errors: this.results.metafields.errors,
        warnings: this.results.metafields.warnings,
        unsupportedTypes: this.results.metafields.unsupportedTypes
      }
    };
  }
}

module.exports = SyncResultTracker;
