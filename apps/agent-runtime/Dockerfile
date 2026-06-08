FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o agent-runtime .

FROM alpine:latest
RUN apk --no-cache add ca-certificates git
WORKDIR /root/
COPY --from=builder /app/agent-runtime .
EXPOSE 8090
CMD ["./agent-runtime"]
