import type { Condition, ConditionGroup, FieldCondition } from './types.ts';

function isConditionGroup(c: Condition): c is ConditionGroup {
  return 'logic' in c;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function evaluateFieldCondition(
  cond: FieldCondition,
  data: Record<string, unknown>,
): boolean {
  const value = data[cond.field];
  switch (cond.op) {
    case 'eq':
      return value === cond.value;
    case 'neq':
      return value !== cond.value;
    case 'gt':
      return (
        typeof value === 'number' &&
        typeof cond.value === 'number' &&
        value > cond.value
      );
    case 'gte':
      return (
        typeof value === 'number' &&
        typeof cond.value === 'number' &&
        value >= cond.value
      );
    case 'lt':
      return (
        typeof value === 'number' &&
        typeof cond.value === 'number' &&
        value < cond.value
      );
    case 'lte':
      return (
        typeof value === 'number' &&
        typeof cond.value === 'number' &&
        value <= cond.value
      );
    case 'in':
      return Array.isArray(cond.value) && cond.value.includes(value);
    case 'not_in':
      return Array.isArray(cond.value) && !cond.value.includes(value);
    case 'contains':
      return (
        typeof value === 'string' &&
        typeof cond.value === 'string' &&
        value.includes(cond.value)
      );
    case 'not_contains':
      return (
        typeof value === 'string' &&
        typeof cond.value === 'string' &&
        !value.includes(cond.value)
      );
    case 'is_empty':
      return isEmpty(value);
    case 'is_not_empty':
      return !isEmpty(value);
    default:
      return false;
  }
}

export function evaluateCondition(
  condition: Condition,
  data: Record<string, unknown>,
): boolean {
  if (isConditionGroup(condition)) {
    const { logic, conditions } = condition;
    if (logic === 'and') return conditions.every((c) => evaluateCondition(c, data));
    return conditions.some((c) => evaluateCondition(c, data));
  }
  return evaluateFieldCondition(condition, data);
}
