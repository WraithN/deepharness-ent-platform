FROM alpine:3.21

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY apps/personal-stub/personal-stub .
COPY apps/personal-stub/config.yaml .

EXPOSE 8090
ENV PORT=8090

CMD ["./personal-stub"]
