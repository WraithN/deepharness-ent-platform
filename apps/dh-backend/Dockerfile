FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app

COPY apps/dh-backend/dh-backend .
COPY apps/dh-backend/config.yaml .
COPY apps/dh-backend/config/commands.yaml ./config/
COPY apps/dh-backend/config/intent_rules.yaml ./config/

EXPOSE 8080
ENV PORT=8080

CMD ["./dh-backend"]
