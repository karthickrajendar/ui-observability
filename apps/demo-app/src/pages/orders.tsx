import { Link, useParams } from 'react-router-dom';

const ORDERS = ['100234', '100235', '100236'];

export function OrdersPage() {
  return (
    <section>
      <h1>Orders</h1>
      <p>
        Opening an order navigates to a dynamic route. The observability SDK reports the route
        template <code>/orders/:orderId</code>, never the raw URL.
      </p>
      <ul>
        {ORDERS.map((id) => (
          <li key={id}>
            <Link to={`/orders/${id}`}>Order #{id}</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrderDetailPage() {
  const { orderId } = useParams();
  return (
    <section>
      <h1>Order #{orderId}</h1>
      <p>This page exists to demonstrate templated route tracking.</p>
      <Link to="/orders">Back to orders</Link>
    </section>
  );
}
