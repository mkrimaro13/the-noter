FROM couchdb:3

LABEL org.opencontainers.image.title="the-noter-backend" \
      org.opencontainers.image.description="CouchDB replication target for The Noter" \
      org.opencontainers.image.source="https://github.com/"

# CouchDB loads every *.ini in local.d/ after the stock local.ini, so this file
# survives image upgrades and keeps the image itself untouched.
COPY config/local.ini /opt/couchdb/etc/local.d/10-thenoter.ini
COPY scripts/init-couchdb.sh /usr/local/bin/init-couchdb.sh
RUN chmod +x /usr/local/bin/init-couchdb.sh

EXPOSE 5984

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:5984/_up || exit 1
