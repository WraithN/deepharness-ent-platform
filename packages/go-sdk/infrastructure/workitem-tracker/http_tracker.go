package workitemtracker

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// Default HTTP tracker behavior constants.
const (
	defaultHTTPTrackerRetries     = 3
	defaultHTTPTrackerTimeout     = 30 * time.Second
	defaultRetryBaseDelay         = time.Second
	defaultMaxResponseBodyBytes   = 10 * 1024 * 1024
	httpTrackerLogPrefix          = "[HTTPTracker] "
	httpTrackerAttemptFormat      = "request failed (attempt %d): %v"
	panicDriverRequired           = "workitemtracker: driver is required"
)

// Error message and format constants.
const (
	errFmtBuildRequestOp            = "build %s request: %w"
	errFmtParseListResponse         = "parse list response: %w"
	errFmtParseGetResponse          = "parse get response: %w"
	errFmtParseUpdateStatusResponse = "parse update status response: %w"
	errFmtExternalAPI               = "external api error: status=%d body=%s"
	externalErrorFormat             = "external error %d: %s"

	opList          = "list"
	opGet           = "get"
	opUpdateStatus  = "update status"
)

// HTTPTracker is a platform-agnostic Tracker that delegates request/response
// details to a Driver and handles HTTP execution, timeout, retry, and logging.
type HTTPTracker struct {
	client  *http.Client
	driver  Driver
	cfg     DriverConfig
	mapping MappingConfig
	timeout time.Duration
}

// NewHTTPTracker creates a Tracker backed by HTTP.
func NewHTTPTracker(client *http.Client, driver Driver, cfg DriverConfig, mapping MappingConfig, timeout time.Duration) *HTTPTracker {
	if client == nil {
		client = http.DefaultClient
	}
	if timeout <= 0 {
		timeout = defaultHTTPTrackerTimeout
	}
	if driver == nil {
		panic(panicDriverRequired)
	}
	return &HTTPTracker{
		client:  client,
		driver:  driver,
		cfg:     cfg,
		mapping: mapping,
		timeout: timeout,
	}
}

// List fetches workitems for a project key.
func (t *HTTPTracker) List(ctx context.Context, projectKey string) ([]workitem.WorkItem, error) {
	body, err := t.doWithRetry(ctx, opList, func() (*http.Request, error) {
		return t.driver.BuildListRequest(ctx, t.cfg, projectKey)
	})
	if err != nil {
		return nil, err
	}
	items, err := t.driver.ParseListResponse(body, t.mapping)
	if err != nil {
		return nil, fmt.Errorf(errFmtParseListResponse, err)
	}
	return items, nil
}

// Get fetches a single workitem by its external ID.
func (t *HTTPTracker) Get(ctx context.Context, externalID string) (*workitem.WorkItem, error) {
	body, err := t.doWithRetry(ctx, opGet, func() (*http.Request, error) {
		return t.driver.BuildGetRequest(ctx, t.cfg, externalID)
	})
	if err != nil {
		return nil, err
	}
	item, err := t.driver.ParseGetResponse(body, t.mapping)
	if err != nil {
		return nil, fmt.Errorf(errFmtParseGetResponse, err)
	}
	return item, nil
}

// UpdateStatus pushes a status change to the external platform.
func (t *HTTPTracker) UpdateStatus(ctx context.Context, externalID string, status workitem.Status) error {
	body, err := t.doWithRetry(ctx, opUpdateStatus, func() (*http.Request, error) {
		return t.driver.BuildUpdateStatusRequest(ctx, t.cfg, externalID, status, t.mapping)
	})
	if err != nil {
		return err
	}
	if err := t.driver.ParseUpdateStatusResponse(body); err != nil {
		return fmt.Errorf(errFmtParseUpdateStatusResponse, err)
	}
	return nil
}

// doWithRetry executes the request produced by newReq with up to defaultHTTPTrackerRetries
// retries (defaultHTTPTrackerRetries+1 attempts total). It immediately fails on authentication/authorization errors (401/403) and
// on client errors that cannot be fixed by retrying (4xx except 408/429). Server
// errors (5xx), 408 Request Timeout, and 429 Too Many Requests are retried with a
// linear backoff. Context cancellation stops retries immediately.
func (t *HTTPTracker) doWithRetry(ctx context.Context, op string, newReq func() (*http.Request, error)) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt <= defaultHTTPTrackerRetries; attempt++ {
		req, err := newReq()
		if err != nil {
			return nil, fmt.Errorf(errFmtBuildRequestOp, op, err)
		}
		body, err := t.doOnce(ctx, req)
		if err == nil {
			return body, nil
		}
		lastErr = err

		var extErr *ExternalError
		if errors.As(err, &extErr) && (extErr.Status == http.StatusUnauthorized || extErr.Status == http.StatusForbidden) {
			return nil, err
		}
		if !isRetriableError(err) {
			return nil, err
		}
		if attempt < defaultHTTPTrackerRetries {
			log.Printf(httpTrackerLogPrefix+httpTrackerAttemptFormat, attempt+1, err)
			if err := sleepWithContext(ctx, time.Duration(attempt+1)*defaultRetryBaseDelay); err != nil {
				return nil, err
			}
		}
	}
	return nil, lastErr
}

// doOnce executes a single HTTP request with a per-attempt timeout and returns
// the response body. HTTP status codes >= 400 are surfaced as *ExternalError so
// doWithRetry can decide whether to retry.
func (t *HTTPTracker) doOnce(ctx context.Context, req *http.Request) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	req = req.WithContext(ctx)
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, defaultMaxResponseBodyBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= http.StatusBadRequest {
		return nil, &ExternalError{Status: resp.StatusCode, Message: string(body)}
	}
	return body, nil
}

// isRetriableError returns true for transient failures that may succeed on retry.
// Non-HTTP errors (e.g. network blips) are assumed retriable. Context cancellation
// is not retriable.
func isRetriableError(err error) bool {
	if errors.Is(err, context.Canceled) {
		return false
	}
	var extErr *ExternalError
	if errors.As(err, &extErr) {
		return extErr.Status >= http.StatusInternalServerError ||
			extErr.Status == http.StatusRequestTimeout ||
			extErr.Status == http.StatusTooManyRequests
	}
	return true
}

// sleepWithContext pauses for d or returns ctx.Err() if the context is canceled.
func sleepWithContext(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// ExternalError surfaces HTTP status codes >= 400 to callers.
type ExternalError struct {
	Status  int
	Message string
}

func (e *ExternalError) Error() string {
	return fmt.Sprintf(externalErrorFormat, e.Status, e.Message)
}
