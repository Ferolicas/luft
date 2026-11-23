# Rutas de LUFT hacia la API (4003) y la web (4002). Se incluye desde cada sitio.
client_max_body_size 12m;

location ^~ /.well-known/acme-challenge/ { root /var/www/luft-acme; default_type text/plain; }
location ^~ /.well-known/luft/ { root /var/www/luft-acme; default_type text/plain; }

location /socket.io/ {
    proxy_pass http://127.0.0.1:4003;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $luft_proto;
    proxy_read_timeout 3600s;
}

location /api/ {
    proxy_pass http://127.0.0.1:4003;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $luft_proto;
    proxy_read_timeout 120s;
    proxy_buffering off;
}

location / {
    proxy_pass http://127.0.0.1:4002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $luft_proto;
    proxy_read_timeout 120s;
    proxy_buffering off;
}
