import { TransportItemType } from '@grafana/faro-web-sdk';
import type {
  BeforeSendHook,
  EventEvent,
  ExceptionEvent,
  LogEvent,
  MeasurementEvent,
  TransportItem,
} from '@grafana/faro-web-sdk';

import type { ObservabilityConfig } from '../config/types';
import { shouldSample, shouldSampleTraceId } from '../sampling/sampling';
import {
  isSensitiveKey,
  sanitizeAttributeString,
  sanitizeAttributes,
  sanitizeUrl,
  scrubText,
} from './sanitize';

interface TraceAttributeValue {
  stringValue?: string;
  bytesValue?: string;
  arrayValue?: { values?: TraceAttributeValue[] };
  kvlistValue?: { values?: TraceAttribute[] };
}

interface TraceAttribute {
  key?: string;
  value?: TraceAttributeValue;
}

interface TracePayloadShape {
  resourceSpans?: Array<{
    resource?: { attributes?: TraceAttribute[] };
    scopeSpans?: Array<{
      scope?: { attributes?: TraceAttribute[] };
      spans?: Array<{
        traceId?: string;
        name?: string;
        attributes?: TraceAttribute[];
        events?: Array<{ name?: string; attributes?: TraceAttribute[] }>;
        links?: Array<{ attributes?: TraceAttribute[] }>;
        status?: { message?: string };
      }>;
    }>;
  }>;
}


function sanitizeTraceValue(
  value: TraceAttributeValue,
  key: string,
  allowQueryParameters: boolean
): TraceAttributeValue {
  if (typeof value.stringValue === 'string') {
    value.stringValue = sanitizeAttributeString(key, value.stringValue, allowQueryParameters);
  }
  if (typeof value.bytesValue === 'string') {
    value.stringValue = '[REDACTED]';
    delete value.bytesValue;
  }
  for (const item of value.arrayValue?.values ?? []) {
    sanitizeTraceValue(item, key, allowQueryParameters);
  }
  for (const attribute of value.kvlistValue?.values ?? []) {
    sanitizeTraceAttribute(attribute, allowQueryParameters);
  }
  return value;
}

function sanitizeTraceAttribute(attribute: TraceAttribute, allowQueryParameters: boolean): void {
  if (attribute.key === undefined || attribute.value === undefined) {
    return;
  }
  if (isSensitiveKey(attribute.key)) {
    attribute.value = { stringValue: '[REDACTED]' };
    return;
  }
  attribute.value = sanitizeTraceValue(attribute.value, attribute.key, allowQueryParameters);
}

function sanitizeTraceAttributes(attributes: TraceAttribute[] | undefined, allowQueryParameters: boolean): void {
  for (const attribute of attributes ?? []) {
    sanitizeTraceAttribute(attribute, allowQueryParameters);
  }
}

function sanitizeTracePayload(payload: TracePayloadShape, allowQueryParameters: boolean): void {
  for (const resourceSpan of payload.resourceSpans ?? []) {
    sanitizeTraceAttributes(resourceSpan.resource?.attributes, allowQueryParameters);
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      sanitizeTraceAttributes(scopeSpan.scope?.attributes, allowQueryParameters);
      for (const span of scopeSpan.spans ?? []) {
        if (span.name) {
          span.name = scrubText(span.name);
        }
        if (span.status?.message) {
          span.status.message = scrubText(span.status.message);
        }
        sanitizeTraceAttributes(span.attributes, allowQueryParameters);
        for (const event of span.events ?? []) {
          if (event.name) {
            event.name = scrubText(event.name);
          }
          sanitizeTraceAttributes(event.attributes, allowQueryParameters);
        }
        for (const link of span.links ?? []) {
          sanitizeTraceAttributes(link.attributes, allowQueryParameters);
        }
      }
    }
  }
}

function extractPrimaryTraceId(payload: TracePayloadShape): string | undefined {
  for (const resourceSpan of payload.resourceSpans ?? []) {
    for (const scopeSpan of resourceSpan.scopeSpans ?? []) {
      for (const span of scopeSpan.spans ?? []) {
        if (typeof span.traceId === 'string' && span.traceId.length > 0) {
          return span.traceId;
        }
      }
    }
  }
  return undefined;
}

/**
 * Builds the single sanitization + sampling gate every Faro transport item
 * passes through before leaving the browser. No telemetry path bypasses it.
 */
export function createBeforeSendHook(config: ObservabilityConfig): BeforeSendHook {
  const allowQuery = config.privacy.allowQueryParameters;

  return (item: TransportItem) => {
    try {
      if (item.meta?.page?.url) {
        item.meta.page.url = sanitizeUrl(item.meta.page.url, allowQuery);
      }

      switch (item.type) {
        case TransportItemType.EXCEPTION: {
          const payload = item.payload as ExceptionEvent;
          if (typeof payload.value === 'string') {
            payload.value = scrubText(payload.value);
          }
          if (payload.context) {
            payload.context = sanitizeAttributes(payload.context, allowQuery);
          }
          break;
        }
        case TransportItemType.LOG: {
          const payload = item.payload as LogEvent;
          if (typeof payload.message === 'string') {
            payload.message = scrubText(payload.message);
          }
          if (payload.context) {
            payload.context = sanitizeAttributes(payload.context, allowQuery);
          }
          break;
        }
        case TransportItemType.EVENT: {
          const payload = item.payload as EventEvent;
          if (payload.attributes) {
            payload.attributes = sanitizeAttributes(payload.attributes, allowQuery);
          }
          break;
        }
        case TransportItemType.MEASUREMENT: {
          // Performance telemetry (Web Vitals and custom measurements) is sampled; errors never are.
          if (!shouldSample(config.sampling.performance)) {
            return null;
          }
          const payload = item.payload as MeasurementEvent;
          if (payload.context) {
            payload.context = sanitizeAttributes(payload.context, allowQuery);
          }
          break;
        }
        case TransportItemType.TRACE: {
          const tracePayload = item.payload as TracePayloadShape;
          const traceId = extractPrimaryTraceId(tracePayload);
          if (!shouldSampleTraceId(traceId, config.sampling.traces)) {
            return null;
          }
          sanitizeTracePayload(tracePayload, allowQuery);
          break;
        }

      }
      return item;
    } catch {
      // Fail closed: if sanitization itself breaks, drop the item rather than leak data.
      return null;
    }
  };
}

